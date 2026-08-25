const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, initDatabase } = require('./db');

const app = express();
const PORT = 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'easymarket_secret_key_2026_supersecure';

// Trust proxy for Cloud Run and reverse proxies
app.set('trust proxy', 1);

// Ensure upload directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ----------------------------------------------------
// Security Middleware & Hardening
// ----------------------------------------------------

// 1. Security Headers (defense against MIME sniffing, clickjacking, XSS)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Download-Options', 'noopen');
  next();
});

// 2. In-Memory Rate Limiter for Login/Auth (anti-brute-force defense)
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 15;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return true;
  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(ip);
    return true;
  }
  return record.count < MAX_FAILED_ATTEMPTS;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || (now - record.firstAttempt > RATE_LIMIT_WINDOW)) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

// 3. Multer Secure File Uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const randomHex = crypto.randomBytes(8).toString('hex');
    const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${Date.now()}_${randomHex}${safeExt}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max per image
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'svg'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Allowed formats: JPG, PNG, WEBP, SVG.'));
    }
  }
});

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body & Cookie Parsers
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// URL Normalizer: Fix any accidental double relative paths like /admin_dashboard.php/admin_dashboard.php
app.use((req, res, next) => {
  if (req.originalUrl && req.originalUrl.includes('admin_dashboard.php/admin_dashboard.php')) {
    const cleaned = req.originalUrl.replace(/admin_dashboard\.php\/admin_dashboard\.php/g, 'admin_dashboard.php');
    return res.redirect(cleaned);
  }
  next();
});

// Express Session configured for iframes and proxy compatibility
app.use(session({
  name: 'easymarket_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'none',
    secure: true
  }
}));

// Signed Auth Token Generator / Verifier
function createAuthToken(userData) {
  const payload = Buffer.from(JSON.stringify(userData)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

// Global Auth Context & Notification Badge Middleware
app.use(async (req, res, next) => {
  res.locals.db = db;
  res.locals.sanitizeWhatsAppNumber = db.sanitizeWhatsAppNumber;
  res.locals.currentPath = req.path || '';
  res.locals.originalUrl = req.originalUrl || '';

  if (!req.session || !req.session.user_id) {
    const token = req.cookies.em_token || req.headers['x-auth-token'];
    const verified = verifyAuthToken(token);
    if (verified && verified.id) {
      req.session.user_id = verified.id;
      req.session.user_name = verified.name;
      req.session.user_email = verified.email;
      req.session.is_admin = verified.is_admin ? 1 : 0;
    }
  }

  res.locals.user = (req.session && req.session.user_id) ? {
    id: req.session.user_id,
    name: req.session.user_name,
    email: req.session.user_email,
    is_admin: req.session.is_admin
  } : null;

  res.locals.unreadNotifsCount = 0;
  res.locals.unreadMsgsCount = 0;

  if (res.locals.user) {
    try {
      const notifs = await db.getNotificationsByUser(res.locals.user.id);
      res.locals.unreadNotifsCount = notifs.filter(n => !n.is_read).length;
      const convs = await db.getConversationsForUser(res.locals.user.id);
      res.locals.unreadMsgsCount = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    } catch (e) {
      // benign
    }
  }

  next();
});

function setAuthSession(req, res, userPayload) {
  req.session.user_id = userPayload.id;
  req.session.user_name = userPayload.name;
  req.session.user_email = userPayload.email;
  req.session.is_admin = userPayload.is_admin ? 1 : 0;

  const token = createAuthToken({
    id: userPayload.id,
    name: userPayload.name,
    email: userPayload.email,
    is_admin: userPayload.is_admin ? 1 : 0
  });

  res.cookie('em_token', token, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'none',
    secure: true
  });
}

function clearAuthSession(req, res) {
  req.session.destroy(() => {});
  res.clearCookie('easymarket_sid', { sameSite: 'none', secure: true });
  res.clearCookie('em_token', { sameSite: 'none', secure: true });
}

// ----------------------------------------------------
// CORE MARKETPLACE ROUTES
// ----------------------------------------------------

// 1. Home / Index
app.get(['/', '/index.php', '/index'], async (req, res) => {
  try {
    const categories = await db.getCategories();
    const search = (req.query.search || '').trim().toLowerCase();
    const categorySelected = parseInt(req.query.category_id, 10) || 0;
    const minPrice = parseFloat(req.query.price_min) || 0;
    const maxPrice = parseFloat(req.query.price_max) || 0;
    const sort = req.query.sort || 'newest';

    const isNewlyRegistered = req.session && req.session.justRegistered;
    if (isNewlyRegistered) {
      delete req.session.justRegistered;
    }

    let filtered = await db.getProducts(p => p.approved === 1 && p.quantity > 0);

    if (search) {
      filtered = filtered.filter(p =>
        (p.title && p.title.toLowerCase().includes(search)) ||
        (p.description && p.description.toLowerCase().includes(search)) ||
        (p.location && p.location.toLowerCase().includes(search))
      );
    }

    if (categorySelected > 0) {
      filtered = filtered.filter(p => p.category_id === categorySelected);
    }

    if (minPrice > 0) {
      filtered = filtered.filter(p => p.price >= minPrice);
    }

    if (maxPrice > 0 && maxPrice >= minPrice) {
      filtered = filtered.filter(p => p.price <= maxPrice);
    }

    switch (sort) {
      case 'price_asc':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'title':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'newest':
      default:
        filtered.sort((a, b) => b.id - a.id);
        break;
    }

    res.render('index', {
      categories,
      products: filtered,
      search: req.query.search || '',
      categorySelected,
      minPrice,
      maxPrice,
      sort,
      isNewlyRegistered
    });
  } catch (err) {
    console.error('Error loading index:', err);
    res.status(500).send('Internal Server Error');
  }
});

// 2. Category page
app.get(['/category.php', '/category'], async (req, res) => {
  try {
    const categories = await db.getCategories();
    const id = parseInt(req.query.id, 10) || 0;
    const category = categories.find(c => c.id === id);
    if (!category) {
      return res.redirect('index.php');
    }

    const search = (req.query.search || '').trim().toLowerCase();
    const sort = req.query.sort || 'newest';

    let filtered = await db.getProducts(p => p.category_id === id && p.approved === 1 && p.quantity > 0);

    if (search) {
      filtered = filtered.filter(p =>
        (p.title && p.title.toLowerCase().includes(search)) ||
        (p.description && p.description.toLowerCase().includes(search)) ||
        (p.location && p.location.toLowerCase().includes(search))
      );
    }

    switch (sort) {
      case 'price_asc':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'title':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'newest':
      default:
        filtered.sort((a, b) => b.id - a.id);
        break;
    }

    res.render('category', {
      category,
      categories,
      products: filtered,
      search: req.query.search || '',
      sort
    });
  } catch (err) {
    console.error('Error loading category:', err);
    res.status(500).send('Internal Server Error');
  }
});

// 3. Product Details
app.get(['/product.php', '/product'], async (req, res) => {
  try {
    const id = parseInt(req.query.id, 10) || 0;
    const product = await db.getProductById(id);
    if (!product) {
      return res.redirect('index.php');
    }

    const userId = req.session ? req.session.user_id : null;
    const isAdmin = req.session && req.session.is_admin === 1;
    const isOwner = !!(userId && product.seller_id === userId);

    // If product is unapproved or sold out (0 stock), only allow admin or product owner to view
    if ((product.approved !== 1 || product.quantity <= 0) && !isAdmin && !isOwner) {
      return res.redirect('index.php');
    }

    const images = await db.getProductImages(id);
    const similar = (await db.getProducts(p => p.category_id === product.category_id && p.id !== id && p.approved === 1 && p.quantity > 0)).slice(0, 4);

    // Pending price request if any
    const pendingPriceRequest = await db.getPendingPriceChangeRequestsForProduct(id);

    // Formatted WhatsApp URL for Uganda
    const waNumber = db.sanitizeWhatsAppNumber(product.whatsapp_number || product.phone);
    const waMessage = encodeURIComponent(`Hello! I am inquiring about "${product.title}" listed for UGX ${Number(product.price).toLocaleString()} on EasyMarket. Is it still available?`);
    const waLink = waNumber ? `https://wa.me/${waNumber}?text=${waMessage}` : null;

    res.render('product', {
      product,
      images,
      similar,
      waLink,
      waNumber,
      isOwner,
      isAdmin,
      pendingPriceRequest
    });
  } catch (err) {
    console.error('Error loading product:', err);
    res.status(500).send('Internal Server Error');
  }
});

// 4. Cart
app.get(['/cart.php', '/cart'], (req, res) => {
  res.render('cart');
});

// 5. Checkout
app.get(['/checkout.php', '/checkout'], (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php?return=checkout.php');
  }
  res.render('checkout', {
    errors: [],
    success: null,
    address: '',
    phone: '',
    payment_reference: ''
  });
});

app.post(['/checkout.php', '/checkout'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php?return=checkout.php');
  }

  const cartJson = (req.body.cart_data || '').trim();
  const address = (req.body.address || '').trim();
  const phone = (req.body.phone || '').trim();
  const paymentReference = (req.body.payment_reference || '').trim();

  const errors = [];
  if (!cartJson) errors.push('Your cart is empty. Add items before checking out.');
  if (!address) errors.push('Delivery address is required.');
  if (!phone) errors.push('A phone number is required.');

  let cartItems = [];
  try {
    cartItems = JSON.parse(cartJson);
  } catch {
    errors.push('Invalid cart data. Please refresh the page and try again.');
  }

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    if (errors.length === 0) errors.push('Your cart is empty. Add items before checking out.');
  }

  let total = 0;
  const validatedItems = [];

  if (errors.length === 0) {
    for (const item of cartItems) {
      const productId = parseInt(item.id, 10) || 0;
      const quantity = parseInt(item.quantity, 10) || 0;

      if (productId <= 0 || quantity <= 0) {
        errors.push('Cart contains invalid product quantities or references.');
        break;
      }

      const prod = await db.getProductById(productId);
      if (!prod || prod.approved !== 1) {
        errors.push('One of the products in your cart is no longer available.');
        break;
      }

      if (quantity > prod.quantity) {
        errors.push(`Only ${prod.quantity} unit(s) of "${prod.title}" are available.`);
        break;
      }

      const price = parseFloat(prod.price);
      total += price * quantity;
      validatedItems.push({
        product_id: productId,
        title: prod.title,
        price: price,
        quantity: quantity,
        image: (item.image || prod.image || '').trim()
      });
    }
  }

  if (errors.length > 0) {
    return res.render('checkout', {
      errors,
      success: null,
      address,
      phone,
      payment_reference: paymentReference
    });
  }

  try {
    const orderId = await db.createOrder({
      userId: req.session.user_id,
      total,
      address,
      phone,
      paymentReference,
      items: validatedItems
    });

    res.render('checkout', {
      errors: [],
      success: `Order #${orderId} has been successfully placed! Our fulfillment team will contact you shortly.`,
      address: '',
      phone: '',
      payment_reference: ''
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.render('checkout', {
      errors: ['Failed to place order due to a server issue. Please try again.'],
      success: null,
      address,
      phone,
      payment_reference: paymentReference
    });
  }
});

// 6. User Orders
app.get(['/orders.php', '/orders'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php?return=orders.php');
  }

  try {
    const orders = await db.getOrdersByUser(req.session.user_id);
    res.render('orders', { orders });
  } catch (err) {
    console.error('Error loading orders:', err);
    res.status(500).send('Internal Server Error');
  }
});

// 7. Sell / Upload Product
app.get(['/upload.php', '/upload'], async (req, res) => {
  const categories = await db.getCategories();
  res.render('upload', {
    categories,
    errors: [],
    success: null,
    formData: null
  });
});

app.post(['/upload.php', '/upload'], upload.fields([
  { name: 'front_image', maxCount: 1 },
  { name: 'back_image', maxCount: 1 },
  { name: 'left_image', maxCount: 1 },
  { name: 'right_image', maxCount: 1 },
  { name: 'top_image', maxCount: 1 },
  { name: 'photos', maxCount: 10 },
  { name: 'images', maxCount: 10 }
]), async (req, res) => {
  const categories = await db.getCategories();
  const errors = [];

  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const price = parseFloat(req.body.price) || 0;
  const quantity = isNaN(parseInt(req.body.quantity, 10)) ? 1 : Math.max(1, parseInt(req.body.quantity, 10));
  const categoryId = parseInt(req.body.category, 10) || 0;
  const phone = (req.body.phone || '').trim();
  const whatsappNumber = (req.body.whatsapp_number || req.body.phone || '').trim();
  const location = (req.body.location || '').trim();
  const payment = (req.body.payment || '').trim();

  if (!title) errors.push('Title is required.');
  if (!description) errors.push('Description is required.');
  if (price <= 0) errors.push('Price must be greater than zero.');
  if (quantity < 0) errors.push('Quantity must be 0 or more.');
  if (categoryId <= 0) errors.push('Please select a product category.');
  if (!phone) errors.push('Seller contact phone number is required.');
  if (!location) errors.push('Seller location in Uganda is required.');

  const files = req.files || {};
  const uploadedFiles = [];

  // Front/Main image is the primary view
  if (files['front_image'] && files['front_image'].length > 0) {
    uploadedFiles.push(files['front_image'][0].filename);
  }

  // Any individual perspective angle views
  ['back_image', 'left_image', 'right_image', 'top_image'].forEach(view => {
    if (files[view] && files[view].length > 0) {
      const fn = files[view][0].filename;
      if (!uploadedFiles.includes(fn)) {
        uploadedFiles.push(fn);
      }
    }
  });

  // Any batch multiple photo selections
  ['photos', 'images'].forEach(field => {
    if (files[field] && files[field].length > 0) {
      files[field].forEach(f => {
        if (!uploadedFiles.includes(f.filename)) {
          uploadedFiles.push(f.filename);
        }
      });
    }
  });

  // Fallback if no front_image specifically tagged
  if (uploadedFiles.length === 0) {
    for (const key of Object.keys(files)) {
      if (Array.isArray(files[key])) {
        files[key].forEach(f => {
          if (!uploadedFiles.includes(f.filename)) {
            uploadedFiles.push(f.filename);
          }
        });
      }
    }
  }

  if (uploadedFiles.length === 0) {
    errors.push('Please upload at least one clear product image.');
  }

  if (errors.length > 0) {
    uploadedFiles.forEach(f => {
      try { fs.unlinkSync(path.join(uploadsDir, f)); } catch {}
    });

    return res.render('upload', {
      categories,
      errors,
      success: null,
      formData: req.body
    });
  }

  try {
    const newProdId = await db.createProduct({
      title,
      description,
      price,
      category_id: categoryId,
      phone,
      whatsapp_number: whatsappNumber,
      location,
      payment_code: payment,
      quantity,
      images: uploadedFiles,
      seller_id: (req.session && req.session.user_id) ? req.session.user_id : null
    });

    res.render('upload', {
      categories,
      errors: [],
      success: `Product "${title}" uploaded successfully with ${uploadedFiles.length} photo(s)! (Listing ID: #${newProdId})`,
      formData: null
    });
  } catch (err) {
    console.error('Error uploading product:', err);
    res.render('upload', {
      categories,
      errors: ['An unexpected error occurred while saving your product to the database: ' + (err.message || 'Server error')],
      success: null,
      formData: req.body
    });
  }
});

// 8. Direct In-App Messaging System
app.get(['/messages.php', '/messages'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php?return=messages.php');
  }

  const userId = req.session.user_id;
  const toUserId = parseInt(req.query.to, 10) || 0;
  const productId = parseInt(req.query.product_id, 10) || 0;

  const conversations = await db.getConversationsForUser(userId);
  let activeMessages = [];
  let counterparty = null;
  let activeProduct = null;

  if (toUserId > 0 && toUserId !== userId) {
    counterparty = await db.findUserById(toUserId);
    if (!counterparty) {
      // default to admin
      counterparty = { id: 2, name: 'EasyMarket Support & Admin', whatsapp_number: '256763480495' };
    }
    activeMessages = await db.getMessagesBetweenUsers(userId, toUserId);
    if (productId > 0) {
      activeProduct = await db.getProductById(productId);
    }
  } else if (conversations.length > 0) {
    const firstConv = conversations[0];
    counterparty = await db.findUserById(firstConv.counterpartyId);
    activeMessages = await db.getMessagesBetweenUsers(userId, firstConv.counterpartyId);
  }

  res.render('messages', {
    conversations,
    activeMessages,
    counterparty,
    activeProduct,
    userId
  });
});

app.post(['/messages.php', '/messages'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php?return=messages.php');
  }

  const senderId = req.session.user_id;
  const receiverId = parseInt(req.body.receiver_id, 10) || 2;
  const productId = parseInt(req.body.product_id, 10) || null;
  const message = (req.body.message || '').trim();

  if (message && receiverId !== senderId) {
    await db.sendMessage({
      senderId,
      receiverId,
      productId,
      message
    });
  }

  res.redirect(`messages.php?to=${receiverId}${productId ? `&product_id=${productId}` : ''}`);
});

// 9. Notifications Center
app.get(['/notifications.php', '/notifications'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php?return=notifications.php');
  }

  const notifications = await db.getNotificationsByUser(req.session.user_id);
  res.render('notifications', { notifications });
});

app.post(['/notifications.php/read', '/notifications/read'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.json({ success: false });
  }

  const notifId = parseInt(req.body.id, 10);
  if (notifId) {
    await db.markNotificationAsRead(notifId, req.session.user_id);
  }
  res.json({ success: true });
});

// 10. Customer Support Help Center
app.get(['/support.php', '/support'], async (req, res) => {
  const tickets = (req.session && req.session.user_id) 
    ? (await db.getAllSupportTickets()).filter(t => t.user_id === req.session.user_id)
    : [];

  res.render('support', {
    tickets,
    success: req.query.sent ? 'Your support ticket has been submitted. Our team will review and reply promptly.' : null,
    errors: []
  });
});

app.post(['/support.php', '/support'], async (req, res) => {
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();
  const name = (req.body.name || (req.session ? req.session.user_name : '') || '').trim();
  const email = (req.body.email || (req.session ? req.session.user_email : '') || '').trim();

  if (!subject || !message) {
    const tickets = (req.session && req.session.user_id) 
      ? (await db.getAllSupportTickets()).filter(t => t.user_id === req.session.user_id)
      : [];
    return res.render('support', {
      tickets,
      errors: ['Subject and Message are required.'],
      success: null
    });
  }

  await db.createSupportTicket({
    userId: req.session ? req.session.user_id : null,
    userName: name || 'Customer',
    userEmail: email || 'customer@easymarket.ug',
    subject,
    message
  });

  res.redirect('support.php?sent=1');
});

// 11. Customer Returns & Refunds
app.post(['/returns.php', '/returns'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('login.php');
  }

  const orderId = parseInt(req.body.order_id, 10);
  const reason = (req.body.reason || '').trim();
  const amount = parseFloat(req.body.amount) || 0;

  if (orderId && reason) {
    await db.createReturnRefund({
      orderId,
      userId: req.session.user_id,
      reason,
      amount
    });
  }

  res.redirect('orders.php');
});

// ----------------------------------------------------
// AUTHENTICATION ROUTES
// ----------------------------------------------------

// Login
app.get(['/login.php', '/login'], (req, res) => {
  if (req.session && req.session.user_id) {
    return res.redirect('index.php');
  }
  res.render('login', {
    errors: [],
    email: '',
    returnTo: req.query.return || ''
  });
});

app.post(['/login.php', '/login'], async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    return res.render('login', {
      errors: ['Too many failed attempts. Please wait 5 minutes before trying again.'],
      email: '',
      returnTo: req.body.return || ''
    });
  }

  const emailInput = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const returnTo = req.body.return || '';

  const errors = [];
  if (!emailInput || !password) {
    errors.push('Please enter your email and password.');
  }

  let user = null;
  if (errors.length === 0) {
    user = await db.findUserByEmailOrUsername(emailInput);
    if (!user) {
      recordFailedLogin(clientIp);
      errors.push('Invalid email address or password.');
    } else {
      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        recordFailedLogin(clientIp);
        errors.push('Invalid email address or password.');
      }
    }
  }

  if (errors.length > 0) {
    return res.render('login', {
      errors,
      email: emailInput,
      returnTo
    });
  }

  resetRateLimit(clientIp);

  setAuthSession(req, res, {
    id: user.id,
    name: user.name,
    email: user.email,
    is_admin: user.is_admin ? 1 : 0
  });

  req.session.save(() => {
    if (user.is_admin === 1) {
      return res.redirect('admin_dashboard.php');
    }
    if (returnTo && !returnTo.startsWith('http') && !returnTo.startsWith('//')) {
      return res.redirect(returnTo);
    }
    res.redirect('index.php');
  });
});

// Register (with WhatsApp prompt & Fallback)
app.get(['/register.php', '/register'], (req, res) => {
  if (req.session && req.session.user_id) {
    return res.redirect('index.php');
  }
  res.render('register', {
    errors: [],
    name: '',
    email: '',
    phone: '',
    whatsapp_number: ''
  });
});

app.post(['/register.php', '/register'], async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const phone = (req.body.phone || '').trim();
  const whatsappNumber = (req.body.whatsapp_number || '').trim();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';

  const errors = [];
  if (!name || !email || !password || !confirm) {
    errors.push('Name, email, and password fields are required.');
  }
  if (!email.includes('@')) {
    errors.push('Enter a valid email address.');
  }
  if (password !== confirm) {
    errors.push('Passwords do not match.');
  }
  if (password.length < 6) {
    errors.push('Password should be at least 6 characters.');
  }

  if (errors.length === 0) {
    const existing = await db.findUserByEmailOrUsername(email);
    if (existing) {
      errors.push('This email is already registered.');
    }
  }

  if (errors.length > 0) {
    return res.render('register', {
      errors,
      name,
      email,
      phone,
      whatsapp_number: whatsappNumber
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const newUser = await db.createUser(name, email, hash, 0, phone, whatsappNumber);

  setAuthSession(req, res, {
    id: newUser.id,
    name: name,
    email: email,
    is_admin: 0
  });

  req.session.justRegistered = true;

  req.session.save(() => {
    res.redirect('index.php');
  });
});

// Admin Auth: Login
app.get(['/admin_login.php', '/admin_login'], (req, res) => {
  if (req.session && req.session.user_id && req.session.is_admin === 1) {
    return res.redirect('admin_dashboard.php');
  }
  res.render('admin_login', {
    errors: [],
    email: ''
  });
});

app.post(['/admin_login.php', '/admin_login'], async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    return res.render('admin_login', {
      errors: ['Too many failed attempts. Please wait 5 minutes before trying again.'],
      email: ''
    });
  }

  const emailInput = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const errors = [];
  if (!emailInput || !password) {
    errors.push('Please enter admin credentials.');
  }

  let user = null;
  if (errors.length === 0) {
    user = await db.findUserByEmailOrUsername(emailInput);
    if (!user || user.is_admin !== 1) {
      recordFailedLogin(clientIp);
      errors.push('Invalid admin credentials.');
    } else {
      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        recordFailedLogin(clientIp);
        errors.push('Invalid admin credentials.');
      }
    }
  }

  if (errors.length > 0) {
    return res.render('admin_login', {
      errors,
      email: emailInput
    });
  }

  resetRateLimit(clientIp);

  setAuthSession(req, res, {
    id: user.id,
    name: user.name,
    email: user.email,
    is_admin: 1
  });

  req.session.save(() => {
    res.redirect('admin_dashboard.php');
  });
});

// Admin Auth: Register
app.get(['/admin_register.php', '/admin_register'], (req, res) => {
  if (req.session && req.session.user_id) {
    return res.redirect('index.php');
  }
  res.render('admin_register', {
    errors: [],
    name: '',
    email: ''
  });
});

app.post(['/admin_register.php', '/admin_register'], async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';
  const adminCode = (req.body.admin_code || '').trim();

  const errors = [];
  if (!name || !email || !password || !confirm) {
    errors.push('All fields are required.');
  }
  if (!email.includes('@')) {
    errors.push('Enter a valid email address.');
  }
  if (password !== confirm) {
    errors.push('Passwords do not match.');
  }
  if (password.length < 6) {
    errors.push('Password should be at least 6 characters.');
  }
  if (adminCode !== 'ADMIN2026' && adminCode !== '@@!!easymarketadmin!@') {
    errors.push('Invalid admin code.');
  }

  if (errors.length === 0) {
    const existing = await db.findUserByEmailOrUsername(email);
    if (existing) {
      errors.push('This email is already registered.');
    }
  }

  if (errors.length > 0) {
    return res.render('admin_register', {
      errors,
      name,
      email
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const newAdmin = await db.createUser(name, email, hash, 1);

  setAuthSession(req, res, {
    id: newAdmin.id,
    name: name,
    email: email,
    is_admin: 1
  });

  req.session.save(() => {
    res.redirect('admin_dashboard.php');
  });
});

// ----------------------------------------------------
// SELLER / USER PRODUCT & PRICE MANAGEMENT SUITE
// ----------------------------------------------------

// Seller: View My Published Products & Pricing Proposals
app.get(['/my_products.php', '/my_products', '/seller/products'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('/login.php?return=my_products.php');
  }

  const userId = req.session.user_id;
  const products = await db.getProductsBySeller(userId);
  const pendingRequests = await db.getPendingPriceChangeRequestsForSeller(userId);
  const feedback = req.session.sellerFeedback || null;
  req.session.sellerFeedback = null;

  res.render('my_products', {
    products,
    pendingRequests,
    feedback
  });
});

// Seller: Direct Price & Stock Update (Only publisher can change their own price)
app.post(['/seller/update-price', '/my_products/update-price'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('/login.php?return=my_products.php');
  }

  const productId = parseInt(req.body.product_id, 10);
  const price = req.body.price;
  const quantity = req.body.quantity;

  const result = await db.updateProductPriceBySeller(productId, req.session.user_id, price, quantity);
  if (result.success) {
    req.session.sellerFeedback = {
      type: 'success',
      message: `✅ Listing updated successfully! Active price is now UGX ${Number(result.newPrice).toLocaleString()}.`
    };
  } else {
    req.session.sellerFeedback = {
      type: 'error',
      message: `❌ ${result.error || 'Failed to update listing.'}`
    };
  }

  req.session.save(() => {
    res.redirect('/my_products.php');
  });
});

// Seller: Respond to Admin Price Proposal (Accept / Decline)
app.post(['/seller/price-request/respond', '/price-request/respond'], async (req, res) => {
  if (!req.session || !req.session.user_id) {
    return res.redirect('/login.php?return=my_products.php');
  }

  const requestId = parseInt(req.body.request_id, 10);
  const decision = req.body.decision; // 'Accepted' or 'Rejected'

  const result = await db.resolvePriceChangeRequest(requestId, decision, req.session.user_id);
  if (result.success) {
    req.session.sellerFeedback = {
      type: result.decision === 'Accepted' ? 'success' : 'info',
      message: result.message
    };
  } else {
    req.session.sellerFeedback = {
      type: 'error',
      message: result.error
    };
  }

  req.session.save(() => {
    res.redirect('/my_products.php');
  });
});

// ----------------------------------------------------
// ADMIN DASHBOARD & MANAGEMENT SUITE
// ----------------------------------------------------

app.get(['/admin_dashboard.php', '/admin_dashboard'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const allProducts = (await db.getProducts()).sort((a, b) => b.id - a.id);
  const availableProducts = allProducts.filter(p => p.quantity > 0 && p.approved === 1);
  const soldProducts = allProducts.filter(p => p.quantity <= 0);
  const priceRequests = await db.getAllPriceChangeRequests();
  const pendingPriceRequests = priceRequests.filter(r => r.status === 'Pending');

  const stats = await db.getSystemStats();
  const activeTab = req.query.tab || 'overview';
  const filter = req.query.filter || 'all';

  let displayedProducts = allProducts;
  if (filter === 'available') {
    displayedProducts = availableProducts;
  } else if (filter === 'sold') {
    displayedProducts = soldProducts;
  }

  const syncResult = req.session.syncResult || null;
  req.session.syncResult = null;

  const adminFeedback = req.session.adminFeedback || null;
  req.session.adminFeedback = null;

  res.render('admin_dashboard', {
    products: displayedProducts,
    allProductsCount: allProducts.length,
    availableCount: availableProducts.length,
    soldCount: soldProducts.length,
    pendingPriceCount: pendingPriceRequests.length,
    priceRequests,
    filter,
    stats,
    activeTab,
    syncResult,
    adminFeedback
  });
});

// Admin: Update Owner Commission / Platform Payout Share %
app.post(['/admin_dashboard.php/commission-rate', '/admin_dashboard/commission-rate', '/admin/commission-rate'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const newRate = parseFloat(req.body.commission_rate);
  if (!isNaN(newRate)) {
    db.setOwnerCommissionPercentage(newRate);
  }

  res.redirect('/admin_dashboard?tab=overview');
});

// Admin: Update Order Fulfillment Status
app.post(['/admin_dashboard.php/order-status', '/admin_dashboard/order-status', '/admin_dashboard.php/admin_dashboard.php/order-status'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const orderId = parseInt(req.body.order_id, 10);
  const status = req.body.status;
  if (orderId && status) {
    await db.updateOrderStatus(orderId, status);
  }

  res.redirect('/admin_dashboard?tab=orders');
});

// Admin: Quick Product Edit & Protected Price Change Proposal Engine
app.post(['/admin_dashboard.php/quick-product', '/admin_dashboard/quick-product', '/admin_dashboard.php/admin_dashboard.php/quick-product'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const productId = parseInt(req.body.product_id, 10);
  if (productId) {
    const result = await db.adminUpdateProductOrProposePrice(productId, req.session.user_id, {
      title: req.body.title,
      price: req.body.price,
      quantity: req.body.quantity,
      approved: req.body.approved,
      reason: req.body.reason || 'Admin recommended price adjustment'
    });
    req.session.adminFeedback = result.message;
  }

  req.session.save(() => {
    res.redirect('/admin_dashboard?tab=inventory');
  });
});

// Admin: Delete Single Product (Available or Sold)
app.post(['/admin_dashboard.php/delete-product', '/admin_dashboard/delete-product', '/admin/delete-product'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const productId = parseInt(req.body.product_id, 10);
  if (productId) {
    await db.deleteProduct(productId);
    req.session.adminFeedback = `Product #${productId} listing deleted successfully.`;
  }

  req.session.save(() => {
    res.redirect('/admin_dashboard?tab=inventory');
  });
});

// Admin: Delete All Sold Products in Bulk
app.post(['/admin_dashboard.php/delete-sold-products', '/admin_dashboard/delete-sold-products', '/admin/delete-sold-products'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const sold = await db.getSoldProducts();
  let count = 0;
  for (const p of sold) {
    await db.deleteProduct(p.id);
    count++;
  }

  req.session.adminFeedback = `Cleaned up catalog: Successfully deleted ${count} sold/out-of-stock product listing(s).`;

  req.session.save(() => {
    res.redirect('/admin_dashboard?tab=inventory&filter=all');
  });
});

// Admin: Reply to Support Ticket
app.post(['/admin_dashboard.php/reply-ticket', '/admin_dashboard/reply-ticket', '/admin_dashboard.php/admin_dashboard.php/reply-ticket'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const ticketId = parseInt(req.body.ticket_id, 10);
  const reply = (req.body.reply || '').trim();
  const status = req.body.status || 'Resolved';

  if (ticketId && reply) {
    await db.replySupportTicket(ticketId, reply, status);
  }

  res.redirect('/admin_dashboard?tab=customers');
});

// Admin: Update Return/Refund Status
app.post(['/admin_dashboard.php/return-status', '/admin_dashboard/return-status', '/admin_dashboard.php/admin_dashboard.php/return-status'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const returnId = parseInt(req.body.return_id, 10);
  const status = req.body.status;
  const adminNote = (req.body.admin_note || '').trim();

  if (returnId && status) {
    await db.updateReturnStatus(returnId, status, adminNote);
  }

  res.redirect('/admin_dashboard?tab=orders');
});

// Admin: Force Sync Database & Validate PostgreSQL/Supabase Tables
app.post(['/admin_dashboard.php/sync-database', '/admin_dashboard/sync-database', '/admin/sync-database'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  try {
    const result = await db.syncDatabase();
    req.session.syncResult = result;
  } catch (err) {
    req.session.syncResult = { success: false, error: err.message };
  }

  req.session.save(() => {
    res.redirect('/admin_dashboard?tab=overview&synced=1');
  });
});

// Admin legacy stock/delete handler
app.post(['/admin_dashboard.php', '/admin_dashboard'], async (req, res) => {
  if (!req.session || !req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('/admin_login.php');
  }

  const productId = parseInt(req.body.product_id, 10);
  if (req.body.update_quantity) {
    const newQty = parseInt(req.body.quantity, 10) || 0;
    await db.updateProductQuantity(productId, newQty);
  } else if (req.body.delete_product) {
    await db.deleteProduct(productId);
  }

  res.redirect('/admin_dashboard?tab=inventory');
});

// Logout
app.get(['/logout.php', '/logout'], (req, res) => {
  clearAuthSession(req, res);
  res.redirect('index.php');
});

// Start Server & Init Database
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EasyMarket server running on http://0.0.0.0:${PORT}`);
  });
});
