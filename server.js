const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const {
  adminRegistrationCode,
  getCookieOptions,
  isProduction,
  port: PORT,
  sessionSecret: SESSION_SECRET,
  verifyHmacToken
} = require('./config');

const { db, initDatabase } = require('./db');
const { validateEmailAuthenticity } = require('./emailValidator');

const app = express();

app.set('trust proxy', isProduction ? 1 : false);

const uploadsDir = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ----------------------------------------------------
// Security middleware
// ----------------------------------------------------

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (isProduction) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

// ----------------------------------------------------
// Login rate limiting
// ----------------------------------------------------

const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 15;

function getClientIp(req) {
  return String(
    req.ip ||
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    'unknown'
  ).split(',')[0].trim();
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    return true;
  }

  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(ip);
    return true;
  }

  return record.count < MAX_FAILED_ATTEMPTS;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, {
      count: 1,
      firstAttempt: now
    });
    return;
  }

  record.count += 1;
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

// Remove expired rate-limit records periodically.
const rateLimitCleanup = setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

rateLimitCleanup.unref();

// ----------------------------------------------------
// Secure image uploads
// ----------------------------------------------------

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, uploadsDir);
  },

  filename(req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeExtension = /^[.][a-z0-9]+$/.test(extension)
      ? extension
      : '.bin';

    const randomName = crypto.randomBytes(16).toString('hex');
    callback(null, `${Date.now()}_${randomName}${safeExtension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 20,
    fields: 50
  },

  fileFilter(req, file, callback) {
    const extension = path
      .extname(file.originalname)
      .toLowerCase()
      .replace('.', '');

    const allowedExtensions = new Set([
      'jpg',
      'jpeg',
      'png',
      'webp',
      'svg'
    ]);

    if (!allowedExtensions.has(extension)) {
      return callback(
        new Error('Invalid image format. Allowed formats: JPG, PNG, WEBP, SVG.')
      );
    }

    callback(null, true);
  }
});

// ----------------------------------------------------
// Application configuration
// ----------------------------------------------------

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

app.use(express.json({
  limit: '10mb'
}));

app.use(cookieParser(SESSION_SECRET));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use(session({
  name: 'easymarket_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: getCookieOptions()
}));

// ----------------------------------------------------
// Authentication helpers
// ----------------------------------------------------

function createAuthToken(userData) {
  const payload = Buffer
    .from(JSON.stringify(userData))
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function setAuthSession(req, res, userPayload) {
  req.session.user_id = userPayload.id;
  req.session.user_name = userPayload.name || '';
  req.session.user_email = userPayload.email || '';
  req.session.user_phone = userPayload.phone || '';
  req.session.user_whatsapp =
    userPayload.whatsapp_number || userPayload.phone || '';
  req.session.is_admin = userPayload.is_admin ? 1 : 0;

  const token = createAuthToken({
    id: userPayload.id,
    name: userPayload.name || '',
    email: userPayload.email || '',
    phone: userPayload.phone || '',
    whatsapp_number:
      userPayload.whatsapp_number || userPayload.phone || '',
    is_admin: userPayload.is_admin ? 1 : 0
  });

  res.cookie('em_token', token, getCookieOptions());
}

function clearAuthSession(req, res, callback) {
  const cookieOptions = getCookieOptions();

  if (!req.session) {
    res.clearCookie('easymarket_sid', cookieOptions);
    res.clearCookie('em_token', cookieOptions);
    callback?.();
    return;
  }

  req.session.destroy((error) => {
    if (error) {
      console.error('Session destroy error:', error.message);
    }

    res.clearCookie('easymarket_sid', cookieOptions);
    res.clearCookie('em_token', cookieOptions);
    callback?.(error);
  });
}
// ----------------------------------------------------
// Image recovery route
// ----------------------------------------------------

app.get(
  ['/uploads/:filename', '/public/uploads/:filename'],
  async (req, res, next) => {
    const filename = path.basename(String(req.params.filename || ''));

    if (!filename) {
      return res.status(404).send('Image not found');
    }

    const filePath = path.join(uploadsDir, filename);

    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    try {
      const dataUrl = await db.getImageDataByFilename(filename);

      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        const separatorIndex = dataUrl.indexOf(',');

        if (separatorIndex > 0) {
          const metadata = dataUrl.slice(0, separatorIndex);
          const encodedData = dataUrl.slice(separatorIndex + 1);
          const mimeMatch = metadata.match(/^data:([^;]+);base64$/);

          if (mimeMatch && encodedData) {
            const imageBuffer = Buffer.from(encodedData, 'base64');

            if (imageBuffer.length > 0) {
              try {
                fs.writeFileSync(filePath, imageBuffer);
              } catch (writeError) {
                console.warn(
                  '[IMAGE RESTORE] Could not cache image:',
                  writeError.message
                );
              }

              res.setHeader('Content-Type', mimeMatch[1]);
              res.setHeader('Cache-Control', 'public, max-age=86400');
              return res.send(imageBuffer);
            }
          }
        }
      }
    } catch (error) {
      console.warn(
        '[IMAGE RESTORE] Database lookup failed:',
        error.message
      );
    }

    const fallbackSvg = path.join(__dirname, 'public', 'phone-front.svg');

    if (fs.existsSync(fallbackSvg)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(fallbackSvg);
    }

    next();
  }
);

// ----------------------------------------------------
// Legacy URL normalization
// ----------------------------------------------------

app.use((req, res, next) => {
  const originalUrl = String(req.originalUrl || '');

  if (originalUrl.includes('admin_dashboard.php/admin_dashboard.php')) {
    const cleanedUrl = originalUrl.replace(
      /admin_dashboard\.php\/admin_dashboard\.php/g,
      'admin_dashboard.php'
    );

    return res.redirect(302, cleanedUrl);
  }

  next();
});

// ----------------------------------------------------
// Global view/authentication context
// ----------------------------------------------------

app.use(async (req, res, next) => {
  res.locals.db = db;
  res.locals.sanitizeWhatsAppNumber = db.sanitizeWhatsAppNumber;
  res.locals.currentPath = req.path || '';
  res.locals.originalUrl = req.originalUrl || '';

  try {
    if (!req.session?.user_id) {
      const token =
        req.cookies?.em_token ||
        req.headers['x-auth-token'];

      const verified = verifyHmacToken(token);

      if (verified && Number.isInteger(Number(verified.id))) {
        req.session.user_id = Number(verified.id);
        req.session.user_name = verified.name || '';
        req.session.user_email = verified.email || '';
        req.session.user_phone = verified.phone || '';
        req.session.user_whatsapp =
          verified.whatsapp_number || verified.phone || '';
        req.session.is_admin = verified.is_admin ? 1 : 0;
      }
    }

    if (
      req.session?.user_id &&
      (!req.session.user_phone || !req.session.user_whatsapp)
    ) {
      const user = await db.findUserById(req.session.user_id);

      if (user) {
        req.session.user_name = user.name || req.session.user_name || '';
        req.session.user_email = user.email || req.session.user_email || '';
        req.session.user_phone = user.phone || '';
        req.session.user_whatsapp =
          user.whatsapp_number || user.phone || '';
        req.session.is_admin = user.is_admin ? 1 : 0;
      }
    }
  } catch (error) {
    console.warn('Authentication context warning:', error.message);
  }

  res.locals.user = req.session?.user_id
    ? {
        id: req.session.user_id,
        name: req.session.user_name || '',
        email: req.session.user_email || '',
        phone: req.session.user_phone || '',
        whatsapp_number:
          req.session.user_whatsapp ||
          req.session.user_phone ||
          '',
        is_admin: req.session.is_admin ? 1 : 0
      }
    : null;

  res.locals.unreadNotifsCount = 0;
  res.locals.unreadMsgsCount = 0;

  if (res.locals.user) {
    try {
      const notifications = await db.getNotificationsByUser(
        res.locals.user.id
      );

      res.locals.unreadNotifsCount = notifications.filter(
        notification => !notification.is_read
      ).length;

      const conversations = await db.getConversationsForUser(
        res.locals.user.id
      );

      res.locals.unreadMsgsCount = conversations.reduce(
        (total, conversation) =>
          total + Number(conversation.unreadCount || 0),
        0
      );
    } catch (error) {
      console.warn('Notification context warning:', error.message);
    }
  }

  next();
});

// ----------------------------------------------------
// Shared helpers
// ----------------------------------------------------

function isAuthenticated(req) {
  return Boolean(req.session?.user_id);
}

function isAdministrator(req) {
  return Boolean(
    req.session?.user_id &&
    Number(req.session.is_admin) === 1
  );
}

function safeReturnPath(value, fallback = '/index.php') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    !trimmed.startsWith('/')
  ) {
    return fallback;
  }

  return trimmed;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function renderCheckout(res, data = {}) {
  return res.render('checkout', {
    errors: [],
    success: null,
    address: '',
    phone: '',
    payment_reference: '',
    ...data
  });
}

function renderLogin(res, data = {}) {
  return res.render('login', {
    errors: [],
    email: '',
    returnTo: '',
    ...data
  });
}

function renderAdminLogin(res, data = {}) {
  return res.render('admin_login', {
    errors: [],
    email: '',
    ...data
  });
}

// ----------------------------------------------------
// Home page
// ----------------------------------------------------

app.get(['/', '/index.php', '/index'], async (req, res) => {
  try {
    const categories = await db.getCategories();
    const search = String(req.query.search || '').trim().toLowerCase();
    const categorySelected =
      parsePositiveInteger(req.query.category_id) || 0;
    const minPrice = Math.max(0, Number(req.query.price_min) || 0);
    const maxPrice = Math.max(0, Number(req.query.price_max) || 0);
    const sort = String(req.query.sort || 'newest');

    const isNewlyRegistered = Boolean(req.session?.justRegistered);

    if (req.session?.justRegistered) {
      delete req.session.justRegistered;
    }

    let products = await db.getProducts(product =>
      (product.approved === 1 ||
        product.approved === true ||
        product.approved == null) &&
      Number(product.quantity || 0) > 0
    );

    if (search) {
      products = products.filter(product =>
        String(product.title || '').toLowerCase().includes(search) ||
        String(product.description || '').toLowerCase().includes(search) ||
        String(product.location || '').toLowerCase().includes(search)
      );
    }

    if (categorySelected > 0) {
      products = products.filter(
        product => Number(product.category_id) === categorySelected
      );
    }

    if (minPrice > 0) {
      products = products.filter(
        product => Number(product.price) >= minPrice
      );
    }

    if (maxPrice > 0 && maxPrice >= minPrice) {
      products = products.filter(
        product => Number(product.price) <= maxPrice
      );
    }

    switch (sort) {
      case 'price_asc':
        products.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        products.sort((a, b) => b.price - a.price);
        break;
      case 'title':
        products.sort((a, b) =>
          String(a.title || '').localeCompare(String(b.title || ''))
        );
        break;
      default:
        products.sort((a, b) => Number(b.id) - Number(a.id));
        break;
    }

    return res.render('index', {
      categories,
      products,
      search: req.query.search || '',
      categorySelected,
      minPrice,
      maxPrice,
      sort,
      isNewlyRegistered
    });
  } catch (error) {
    console.error('Error loading index:', error);
    return res.status(500).send('Internal Server Error');
  }
});
// ----------------------------------------------------
// Category page
// ----------------------------------------------------

app.get(['/category.php', '/category'], async (req, res) => {
  try {
    const categories = await db.getCategories();
    const categoryId = parsePositiveInteger(req.query.id);
    const category = categories.find(
      item => Number(item.id) === categoryId
    );

    if (!category) {
      return res.redirect('/index.php');
    }

    const search = String(req.query.search || '').trim().toLowerCase();
    const sort = String(req.query.sort || 'newest');

    let products = await db.getProducts(product =>
      Number(product.category_id) === categoryId &&
      (product.approved === 1 ||
        product.approved === true ||
        product.approved == null) &&
      Number(product.quantity || 0) > 0
    );

    if (search) {
      products = products.filter(product =>
        String(product.title || '').toLowerCase().includes(search) ||
        String(product.description || '').toLowerCase().includes(search) ||
        String(product.location || '').toLowerCase().includes(search)
      );
    }

    switch (sort) {
      case 'price_asc':
        products.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        products.sort((a, b) => b.price - a.price);
        break;
      case 'title':
        products.sort((a, b) =>
          String(a.title || '').localeCompare(String(b.title || ''))
        );
        break;
      default:
        products.sort((a, b) => Number(b.id) - Number(a.id));
        break;
    }

    return res.render('category', {
      category,
      categories,
      products,
      search: req.query.search || '',
      sort
    });
  } catch (error) {
    console.error('Error loading category:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// ----------------------------------------------------
// Product details
// ----------------------------------------------------

app.get(['/product.php', '/product'], async (req, res) => {
  try {
    const productId = parsePositiveInteger(req.query.id);
    const product = await db.getProductById(productId);

    if (!product) {
      return res.redirect('/index.php');
    }

    const userId = req.session?.user_id || null;
    const isAdmin = isAdministrator(req);
    const isOwner =
      Boolean(userId) &&
      Number(product.seller_id) === Number(userId);

    if (
      (Number(product.approved) !== 1 ||
        Number(product.quantity || 0) <= 0) &&
      !isAdmin &&
      !isOwner
    ) {
      return res.redirect('/index.php');
    }

    const images = await db.getProductImages(productId);

    const similar = (
      await db.getProducts(candidate =>
        Number(candidate.category_id) === Number(product.category_id) &&
        Number(candidate.id) !== Number(product.id) &&
        Number(candidate.approved) === 1 &&
        Number(candidate.quantity || 0) > 0
      )
    ).slice(0, 4);

    const pendingPriceRequest =
      await db.getPendingPriceChangeRequestsForProduct(productId);

    let sellerPhone =
      product.whatsapp_number ||
      product.seller_user_whatsapp ||
      product.seller_user_phone ||
      product.seller_phone ||
      product.phone ||
      '';

    if (!sellerPhone && product.seller_id) {
      const seller = await db.findUserById(product.seller_id);

      if (seller) {
        sellerPhone = seller.whatsapp_number || seller.phone || '';
      }
    }

    const whatsappNumber = db.sanitizeWhatsAppNumber(sellerPhone);
    const whatsappLink = whatsappNumber
      ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
          `Hello! I am interested in buying "${product.title}" ` +
          `listed for UGX ${Number(product.price).toLocaleString()} ` +
          'on EasyMarket Uganda. Is this item still available?'
        )}`
      : null;

    return res.render('product', {
      product,
      images,
      similar,
      waLink: whatsappLink,
      waNumber: whatsappNumber,
      isOwner,
      isAdmin,
      pendingPriceRequest
    });
  } catch (error) {
    console.error('Error loading product:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// ----------------------------------------------------
// Cart and checkout
// ----------------------------------------------------

app.get(['/cart.php', '/cart'], (req, res) => {
  return res.render('cart');
});

app.get(['/checkout.php', '/checkout'], (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/checkout.php');
  }

  return renderCheckout(res);
});

function parseCart(cartJson) {
  if (typeof cartJson !== 'string' || !cartJson.trim()) {
    throw new Error('Your cart is empty.');
  }

  const parsed = JSON.parse(cartJson);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Your cart is empty.');
  }

  if (parsed.length > 100) {
    throw new Error('Your cart contains too many items.');
  }

  return parsed;
}

app.post(['/checkout.php', '/checkout'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/checkout.php');
  }

  const address = String(req.body.address || '').trim();
  const phone = String(req.body.phone || '').trim();
  const paymentReference =
    String(req.body.payment_reference || '').trim();

  const errors = [];
  let cartItems = [];

  if (!address) {
    errors.push('Delivery address is required.');
  }

  if (!phone) {
    errors.push('A phone number is required.');
  }

  try {
    cartItems = parseCart(req.body.cart_data);
  } catch (error) {
    errors.push(error.message);
  }

  const validatedItems = [];
  let total = 0;

  if (errors.length === 0) {
    for (const item of cartItems) {
      const productId = parsePositiveInteger(item?.id);
      const quantity = parsePositiveInteger(item?.quantity);

      if (!productId || !quantity) {
        errors.push('Cart contains an invalid product or quantity.');
        break;
      }

      const product = await db.getProductById(productId);

      if (!product || Number(product.approved) !== 1) {
        errors.push('A product in your cart is no longer available.');
        break;
      }

      if (quantity > Number(product.quantity || 0)) {
        errors.push(
          `Only ${product.quantity} unit(s) of ` +
          `"${product.title}" are available.`
        );
        break;
      }

      const price = Number.parseFloat(product.price);

      if (!Number.isFinite(price) || price <= 0) {
        errors.push(`Product "${product.title}" has an invalid price.`);
        break;
      }

      total += price * quantity;

      validatedItems.push({
        product_id: productId,
        title: product.title,
        price,
        quantity,
        image: String(item.image || product.image || '').trim()
      });
    }
  }

  if (errors.length > 0) {
    return renderCheckout(res, {
      errors,
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

    return renderCheckout(res, {
      errors: [],
      success:
        `Order #${orderId} has been successfully placed! ` +
        'Our fulfillment team will contact you shortly.',
      orderId,
      orderTotal: total,
      orderAddress: address,
      buyerPhone: phone,
      address: '',
      phone: '',
      payment_reference: ''
    });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_STOCK') {
      return renderCheckout(res, {
        errors: [
          'One or more products sold out while your order was being processed. ' +
          'Please refresh your cart and try again.'
        ],
        address,
        phone,
        payment_reference: paymentReference
      });
    }

    console.error('Error creating order:', error);

    return renderCheckout(res, {
      errors: ['Unable to place the order. Please try again later.'],
      address,
      phone,
      payment_reference: paymentReference
    });
  }
});

// ----------------------------------------------------
// User orders
// ----------------------------------------------------

app.get(['/orders.php', '/orders'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/orders.php');
  }

  try {
    const orders = await db.getOrdersByUser(req.session.user_id);
    return res.render('orders', { orders });
  } catch (error) {
    console.error('Error loading orders:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// ----------------------------------------------------
// Product upload
// ----------------------------------------------------

app.get(['/upload.php', '/upload'], async (req, res) => {
  try {
    const categories = await db.getCategories();

    return res.render('upload', {
      categories,
      errors: [],
      success: null,
      formData: null
    });
  } catch (error) {
    console.error('Error loading upload page:', error);
    return res.status(500).send('Internal Server Error');
  }
});

function collectUploadedFiles(files) {
  const result = [];
  const preferredFields = [
    'front_image',
    'back_image',
    'left_image',
    'right_image',
    'top_image',
    'photos',
    'images'
  ];

  for (const field of preferredFields) {
    for (const file of files?.[field] || []) {
      if (file?.filename && !result.includes(file.filename)) {
        result.push(file.filename);
      }
    }
  }

  if (result.length === 0) {
    for (const fileList of Object.values(files || {})) {
      for (const file of fileList || []) {
        if (file?.filename && !result.includes(file.filename)) {
          result.push(file.filename);
        }
      }
    }
  }

  return result;
}

function removeUploadedFiles(filenames) {
  for (const filename of filenames) {
    const safeFilename = path.basename(String(filename));
    const filePath = path.join(uploadsDir, safeFilename);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(
        'Could not remove uploaded file:',
        error.message
      );
    }
  }
}

app.post(
  ['/upload.php', '/upload'],
  upload.fields([
    { name: 'front_image', maxCount: 1 },
    { name: 'back_image', maxCount: 1 },
    { name: 'left_image', maxCount: 1 },
    { name: 'right_image', maxCount: 1 },
    { name: 'top_image', maxCount: 1 },
    { name: 'photos', maxCount: 10 },
    { name: 'images', maxCount: 10 }
  ]),
  async (req, res) => {
    const categories = await db.getCategories();
    const uploadedFiles = collectUploadedFiles(req.files);
    const errors = [];

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const phone = String(req.body.phone || '').trim();
    const whatsappNumber = String(
      req.body.whatsapp_number || req.body.phone || ''
    ).trim();
    const location = String(req.body.location || '').trim();
    const paymentCode = String(req.body.payment || '').trim();

    const price = Number.parseFloat(req.body.price);
    const quantity = parsePositiveInteger(req.body.quantity) || 1;
    const categoryId = parsePositiveInteger(req.body.category);

    if (!title || title.length > 255) {
      errors.push('Title is required and must be no longer than 255 characters.');
    }

    if (!description) {
      errors.push('Description is required.');
    }

    if (!Number.isFinite(price) || price <= 0) {
      errors.push('Price must be greater than zero.');
    }

    if (!categoryId) {
      errors.push('Please select a product category.');
    }

    if (!phone) {
      errors.push('Seller contact phone number is required.');
    }

    if (!location) {
      errors.push('Seller location is required.');
    }

    if (uploadedFiles.length === 0) {
      errors.push('Please upload at least one product image.');
    }

    if (errors.length > 0) {
      removeUploadedFiles(uploadedFiles);

      return res.render('upload', {
        categories,
        errors,
        success: null,
        formData: req.body
      });
    }

    try {
      const images = uploadedFiles.map(filename => {
        const filePath = path.join(uploadsDir, filename);
        let dataUrl = `/uploads/${filename}`;

        try {
          const fileBuffer = fs.readFileSync(filePath);
          const extension = path.extname(filename).toLowerCase();

          const mimeType =
            extension === '.png'
              ? 'image/png'
              : extension === '.webp'
                ? 'image/webp'
                : extension === '.svg'
                  ? 'image/svg+xml'
                  : 'image/jpeg';

          dataUrl =
            `data:${mimeType};base64,` +
            fileBuffer.toString('base64');
        } catch (error) {
          console.warn(
            'Could not encode uploaded image:',
            error.message
          );
        }

        return {
          filename,
          dataUrl
        };
      });

      const productId = await db.createProduct({
        title,
        description,
        price,
        category_id: categoryId,
        phone,
        whatsapp_number: whatsappNumber,
        location,
        payment_code: paymentCode,
        quantity,
        images,
        seller_id: req.session?.user_id || null
      });

      return res.render('upload', {
        categories,
        errors: [],
        success:
          `Product "${title}" uploaded successfully ` +
          `with ${uploadedFiles.length} photo(s)! ` +
          `(Listing ID: #${productId})`,
        formData: null
      });
    } catch (error) {
      console.error('Error uploading product:', error);
      removeUploadedFiles(uploadedFiles);

      return res.render('upload', {
        categories,
        errors: ['Unable to save the product. Please try again.'],
        success: null,
        formData: req.body
      });
    }
  }
);

// ----------------------------------------------------
// Messaging
// ----------------------------------------------------

app.get(['/messages.php', '/messages'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/messages.php');
  }

  try {
    const userId = req.session.user_id;
    const targetUserId =
      parsePositiveInteger(req.query.to) || 0;
    const productId =
      parsePositiveInteger(req.query.product_id) || 0;

    const conversations =
      await db.getConversationsForUser(userId);

    let activeMessages = [];
    let counterparty = null;
    let activeProduct = null;

    if (targetUserId > 0 && targetUserId !== userId) {
      counterparty = await db.findUserById(targetUserId);

      if (counterparty) {
        activeMessages = await db.getMessagesBetweenUsers(
          userId,
          targetUserId
        );
      }

      if (productId > 0) {
        activeProduct = await db.getProductById(productId);
      }
    } else if (conversations.length > 0) {
      const firstConversation = conversations[0];
      const firstCounterpartyId =
        parsePositiveInteger(firstConversation.counterpartyId);

      if (firstCounterpartyId) {
        counterparty =
          await db.findUserById(firstCounterpartyId);

        activeMessages =
          await db.getMessagesBetweenUsers(
            userId,
            firstCounterpartyId
          );
      }
    }

    return res.render('messages', {
      conversations,
      activeMessages,
      counterparty,
      activeProduct,
      userId
    });
  } catch (error) {
    console.error('Error loading messages:', error);
    return res.status(500).send('Internal Server Error');
  }
});

app.post(['/messages.php', '/messages'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/messages.php');
  }

  const receiverId = parsePositiveInteger(req.body.receiver_id);
  const productId =
    parsePositiveInteger(req.body.product_id) || null;
  const message = String(req.body.message || '').trim();

  if (
    receiverId &&
    receiverId !== Number(req.session.user_id) &&
    message &&
    message.length <= 5000
  ) {
    try {
      await db.sendMessage({
        senderId: req.session.user_id,
        receiverId,
        productId,
        message
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  const query = new URLSearchParams({
    to: String(receiverId || '')
  });

  if (productId) {
    query.set('product_id', String(productId));
  }

  return res.redirect(`/messages.php?${query.toString()}`);
});

// ----------------------------------------------------
// Notifications
// ----------------------------------------------------

app.get(['/notifications.php', '/notifications'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/notifications.php');
  }

  try {
    const notifications =
      await db.getNotificationsByUser(req.session.user_id);

    return res.render('notifications', { notifications });
  } catch (error) {
    console.error('Error loading notifications:', error);
    return res.status(500).send('Internal Server Error');
  }
});

app.post(
  ['/notifications.php/read', '/notifications/read'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    const notificationId =
      parsePositiveInteger(req.body.id);

    if (notificationId) {
      await db.markNotificationAsRead(
        notificationId,
        req.session.user_id
      );
    }

    const notifications =
      await db.getNotificationsByUser(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: notifications.filter(
        notification => !notification.is_read
      ).length
    });
  }
);

app.post(
  ['/notifications.php/read-all', '/notifications/read-all'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    await db.markAllNotificationsAsRead(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: 0
    });
  }
);

app.post(
  ['/notifications.php/delete', '/notifications/delete'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    const notificationId =
      parsePositiveInteger(req.body.id);

    if (notificationId) {
      await db.deleteNotification(
        notificationId,
        req.session.user_id
      );
    }

    const notifications =
      await db.getNotificationsByUser(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: notifications.filter(
        notification => !notification.is_read
      ).length,
      remainingCount: notifications.length
    });
  }
);

app.post(
  ['/notifications.php/delete-all', '/notifications/delete-all'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    await db.deleteAllNotifications(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: 0,
      remainingCount: 0
    });
  }
);

// ----------------------------------------------------
// Support
// ----------------------------------------------------
app.get(['/support.php', '/support'], async (req, res) => {
  try {
    const allTickets = await db.getAllSupportTickets();
    const tickets = isAuthenticated(req)
      ? allTickets.filter(
          ticket =>
            Number(ticket.user_id) ===
            Number(req.session.user_id)
        )
      : [];

    return res.render('support', {
      tickets,
      success: req.query.sent
        ? 'Your support ticket has been submitted.'
        : null,
      errors: []
    });
  } catch (error) {
    console.error('Error loading support:', error);
    return res.status(500).send('Internal Server Error');
  }
});
// ----------------------------------------------------
// Messaging
// ----------------------------------------------------

app.get(['/messages.php', '/messages'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/messages.php');
  }

  try {
    const userId = req.session.user_id;
    const targetUserId =
      parsePositiveInteger(req.query.to) || 0;
    const productId =
      parsePositiveInteger(req.query.product_id) || 0;

    const conversations =
      await db.getConversationsForUser(userId);

    let activeMessages = [];
    let counterparty = null;
    let activeProduct = null;

    if (targetUserId > 0 && targetUserId !== userId) {
      counterparty = await db.findUserById(targetUserId);

      if (counterparty) {
        activeMessages = await db.getMessagesBetweenUsers(
          userId,
          targetUserId
        );
      }

      if (productId > 0) {
        activeProduct = await db.getProductById(productId);
      }
    } else if (conversations.length > 0) {
      const firstConversation = conversations[0];
      const firstCounterpartyId =
        parsePositiveInteger(firstConversation.counterpartyId);

      if (firstCounterpartyId) {
        counterparty =
          await db.findUserById(firstCounterpartyId);

        activeMessages =
          await db.getMessagesBetweenUsers(
            userId,
            firstCounterpartyId
          );
      }
    }

    return res.render('messages', {
      conversations,
      activeMessages,
      counterparty,
      activeProduct,
      userId
    });
  } catch (error) {
    console.error('Error loading messages:', error);
    return res.status(500).send('Internal Server Error');
  }
});

app.post(['/messages.php', '/messages'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/messages.php');
  }

  const receiverId = parsePositiveInteger(req.body.receiver_id);
  const productId =
    parsePositiveInteger(req.body.product_id) || null;
  const message = String(req.body.message || '').trim();

  if (
    receiverId &&
    receiverId !== Number(req.session.user_id) &&
    message &&
    message.length <= 5000
  ) {
    try {
      await db.sendMessage({
        senderId: req.session.user_id,
        receiverId,
        productId,
        message
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  const query = new URLSearchParams({
    to: String(receiverId || '')
  });

  if (productId) {
    query.set('product_id', String(productId));
  }

  return res.redirect(`/messages.php?${query.toString()}`);
});

// ----------------------------------------------------
// Notifications
// ----------------------------------------------------

app.get(['/notifications.php', '/notifications'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php?return=/notifications.php');
  }

  try {
    const notifications =
      await db.getNotificationsByUser(req.session.user_id);

    return res.render('notifications', { notifications });
  } catch (error) {
    console.error('Error loading notifications:', error);
    return res.status(500).send('Internal Server Error');
  }
});

app.post(
  ['/notifications.php/read', '/notifications/read'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    const notificationId =
      parsePositiveInteger(req.body.id);

    if (notificationId) {
      await db.markNotificationAsRead(
        notificationId,
        req.session.user_id
      );
    }

    const notifications =
      await db.getNotificationsByUser(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: notifications.filter(
        notification => !notification.is_read
      ).length
    });
  }
);

app.post(
  ['/notifications.php/read-all', '/notifications/read-all'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    await db.markAllNotificationsAsRead(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: 0
    });
  }
);

app.post(
  ['/notifications.php/delete', '/notifications/delete'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    const notificationId =
      parsePositiveInteger(req.body.id);

    if (notificationId) {
      await db.deleteNotification(
        notificationId,
        req.session.user_id
      );
    }

    const notifications =
      await db.getNotificationsByUser(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: notifications.filter(
        notification => !notification.is_read
      ).length,
      remainingCount: notifications.length
    });
  }
);

app.post(
  ['/notifications.php/delete-all', '/notifications/delete-all'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.json({ success: false });
    }

    await db.deleteAllNotifications(req.session.user_id);

    return res.json({
      success: true,
      unreadCount: 0,
      remainingCount: 0
    });
  }
);

// ----------------------------------------------------
// Support
// ----------------------------------------------------

app.get(['/support.php', '/support'], async (req, res) => {
  try {
    const allTickets = await db.getAllSupportTickets();
    const tickets = isAuthenticated(req)
      ? allTickets.filter(
          ticket =>
            Number(ticket.user_id) ===
            Number(req.session.user_id)
        )
      : [];

    return res.render('support', {
      tickets,
      success: req.query.sent
        ? 'Your support ticket has been submitted.'
        : null,
      errors: []
    });
  } catch (error) {
    console.error('Error loading support:', error);
    return res.status(500).send('Internal Server Error');
  }
});
app.post(['/support.php', '/support'], async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();

  if (
    !subject ||
    !message ||
    subject.length > 255 ||
    message.length > 10000
  ) {
    const tickets = isAuthenticated(req)
      ? (await db.getAllSupportTickets()).filter(
          ticket =>
            Number(ticket.user_id) ===
            Number(req.session.user_id)
        )
      : [];

    return res.render('support', {
      tickets,
      errors: [
        'A valid subject and message are required.'
      ],
      success: null
    });
  }

  const userId = req.session?.user_id || null;
  const user = userId
    ? await db.findUserById(userId)
    : null;

  try {
    await db.createSupportTicket({
      userId,
      userName: user?.name || 'Customer',
      userEmail: user?.email || '',
      subject,
      message
    });

    return res.redirect('/support.php?sent=1');
  } catch (error) {
    console.error('Error creating support ticket:', error);
    return res.status(500).send('Unable to create support ticket.');
  }
});

// ----------------------------------------------------
// Returns and refunds
// ----------------------------------------------------

app.post(['/returns.php', '/returns'], async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect('/login.php');
  }

  const orderId = parsePositiveInteger(req.body.order_id);
  const reason = String(req.body.reason || '').trim();
  const amount = Number.parseFloat(req.body.amount) || 0;

  if (!orderId || !reason || reason.length > 5000) {
    return res.redirect('/orders.php');
  }

  try {
    const orders = await db.getOrdersByUser(req.session.user_id);
    const order = orders.find(
      item => Number(item.id) === Number(orderId)
    );

    if (!order) {
      return res.redirect('/orders.php');
    }

    await db.createReturnRefund({
      orderId,
      userId: req.session.user_id,
      reason,
      amount: Math.max(0, amount)
    });
  } catch (error) {
    console.error('Error creating return request:', error);
  }

  return res.redirect('/orders.php');
});

// ----------------------------------------------------
// Authentication: login
// ----------------------------------------------------

app.get(['/login.php', '/login'], (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/index.php');
  }

  return renderLogin(res, {
    returnTo: safeReturnPath(req.query.return)
  });
});

async function authenticateUser(email, password) {
  if (!email || !password) {
    return null;
  }

  const user = await db.findUserByEmailOrUsername(email);

  if (!user || !user.password_hash) {
    return null;
  }

  const matches = await bcrypt.compare(
    password,
    user.password_hash
  );

  return matches ? user : null;
}

app.post(['/login.php', '/login'], async (req, res) => {
  const clientIp = getClientIp(req);
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body.password || '');
  const returnTo = safeReturnPath(req.body.return);

  if (!checkRateLimit(clientIp)) {
    return renderLogin(res, {
      errors: [
        'Too many failed attempts. Please wait five minutes.'
      ],
      returnTo
    });
  }

  if (!email || !password) {
    recordFailedLogin(clientIp);

    return renderLogin(res, {
      errors: ['Please enter your email and password.'],
      email,
      returnTo
    });
  }

  try {
    const user = await authenticateUser(email, password);

    if (!user) {
      recordFailedLogin(clientIp);

      return renderLogin(res, {
        errors: ['Invalid email address or password.'],
        email,
        returnTo
      });
    }

    resetRateLimit(clientIp);

    setAuthSession(req, res, {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      whatsapp_number:
        user.whatsapp_number || user.phone || '',
      is_admin: user.is_admin ? 1 : 0
    });

    return req.session.save(error => {
      if (error) {
        console.error('Session save error:', error);
        return res.status(500).send('Unable to create session.');
      }

      if (Number(user.is_admin) === 1) {
        return res.redirect('/admin_dashboard.php');
      }

      return res.redirect(returnTo);
    });
  } catch (error) {
    console.error('Login error:', error);
    return renderLogin(res, {
      errors: ['Unable to sign in at this time.'],
      email,
      returnTo
    });
  }
});

// ----------------------------------------------------
// Authentication: registration
// ----------------------------------------------------

app.get(['/register.php', '/register'], (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/index.php');
  }

  return res.render('register', {
    errors: [],
    name: '',
    email: '',
    phone: '',
    whatsapp_number: ''
  });
});
app.post(['/register.php', '/register'], async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const whatsappNumber = String(
    req.body.whatsapp_number || ''
  ).trim();
  const password = String(req.body.password || '');
  const confirmation = String(req.body.confirm || '');

  const formData = {
    name,
    email,
    phone,
    whatsapp_number: whatsappNumber
  };

  const errors = [];

  if (!name || name.length > 255) {
    errors.push('Name is required and must be valid.');
  }

  if (!email) {
    errors.push('Email is required.');
  }

  if (!password || !confirmation) {
    errors.push('Password and confirmation are required.');
  }

  if (password !== confirmation) {
    errors.push('Passwords do not match.');
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters.');
  }

  try {
    if (errors.length === 0) {
      const emailResult =
        await validateEmailAuthenticity(email);

      if (!emailResult.isValid) {
        errors.push(
          emailResult.error || 'Email address is invalid.'
        );
      }
    }

    if (errors.length === 0) {
      const existing =
        await db.findUserByEmailOrUsername(email);

      if (existing) {
        errors.push(
          'This email address is already registered.'
        );
      }
    }

    if (errors.length > 0) {
      return res.render('register', {
        errors,
        ...formData
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await db.createUser(
      name,
      email,
      passwordHash,
      0,
      phone,
      whatsappNumber
    );

    if (!user?.id) {
      throw new Error('User record was not created.');
    }

    setAuthSession(req, res, {
      id: user.id,
      name: user.name || name,
      email: user.email || email,
      phone: user.phone || phone,
      whatsapp_number:
        user.whatsapp_number ||
        whatsappNumber ||
        phone,
      is_admin: 0
    });

    req.session.justRegistered = true;

    return req.session.save(error => {
      if (error) {
        console.error('Registration session error:', error);
        return res.status(500).send('Unable to create session.');
      }

      return res.redirect('/index.php');
    });
  } catch (error) {
    console.error('Registration error:', error);

    return res.render('register', {
      errors: ['Registration could not be completed.'],
      ...formData
    });
  }
});

// ----------------------------------------------------
// Admin login
// ----------------------------------------------------

app.get(['/admin_login.php', '/admin_login'], (req, res) => {
  if (isAdministrator(req)) {
    return res.redirect('/admin_dashboard.php');
  }

  return renderAdminLogin(res);
});

app.post(
  ['/admin_login.php', '/admin_login'],
  async (req, res) => {
    const clientIp = getClientIp(req);
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body.password || '');

    if (!checkRateLimit(clientIp)) {
      return renderAdminLogin(res, {
        errors: [
          'Too many failed attempts. Please wait five minutes.'
        ]
      });
    }

    if (!email || !password) {
      recordFailedLogin(clientIp);

      return renderAdminLogin(res, {
        errors: ['Please enter admin credentials.'],
        email
      });
    }

    try {
      const user = await authenticateUser(email, password);

      if (!user || Number(user.is_admin) !== 1) {
        recordFailedLogin(clientIp);

        return renderAdminLogin(res, {
          errors: ['Invalid admin credentials.'],
          email
        });
      }

      resetRateLimit(clientIp);

      setAuthSession(req, res, {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        whatsapp_number:
          user.whatsapp_number || user.phone || '',
        is_admin: 1
      });

      return req.session.save(error => {
        if (error) {
          console.error('Admin session error:', error);
          return res.status(500).send('Unable to create session.');
        }

        return res.redirect('/admin_dashboard.php');
      });
    } catch (error) {
      console.error('Admin login error:', error);

      return renderAdminLogin(res, {
        errors: ['Unable to sign in at this time.'],
        email
      });
    }
  }
);

// ----------------------------------------------------
// Admin registration
// ----------------------------------------------------

app.get(
  ['/admin_register.php', '/admin_register'],
  (req, res) => {
    if (isAuthenticated(req)) {
      return res.redirect('/index.php');
    }

    return res.render('admin_register', {
      errors: [],
      name: '',
      email: ''
    });
  }
);

app.post(
  ['/admin_register.php', '/admin_register'],
  async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body.password || '');
    const confirmation = String(req.body.confirm || '');
    const code = String(req.body.admin_code || '').trim();

    const errors = [];

    if (!name || name.length > 255) {
      errors.push('Name is required and must be valid.');
    }

    if (!email) {
      errors.push('Email is required.');
    }

    if (password.length < 8) {
      errors.push('Password must be at least 8 characters.');
    }

    if (password !== confirmation) {
      errors.push('Passwords do not match.');
    }

    if (!adminRegistrationCode || code !== adminRegistrationCode) {
      errors.push('Invalid admin registration code.');
    }

    try {
      if (errors.length === 0) {
        const emailResult =
          await validateEmailAuthenticity(email);

        if (!emailResult.isValid) {
          errors.push(
            emailResult.error || 'Email address is invalid.'
          );
        }
      }

      if (errors.length === 0) {
        const existing =
          await db.findUserByEmailOrUsername(email);

        if (existing) {
          errors.push(
            'This email address is already registered.'
          );
        }
      }

      if (errors.length > 0) {
        return res.render('admin_register', {
          errors,
          name,
          email
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const user = await db.createUser(
        name,
        email,
        passwordHash,
        1
      );

      if (!user?.id) {
        throw new Error('Admin account was not created.');
      }

      setAuthSession(req, res, {
        id: user.id,
        name: user.name || name,
        email: user.email || email,
        phone: user.phone || '',
        whatsapp_number:
          user.whatsapp_number || user.phone || '',
        is_admin: 1
      });

      return req.session.save(error => {
        if (error) {
          console.error('Admin registration session error:', error);
          return res.status(500).send('Unable to create session.');
        }

        return res.redirect('/admin_dashboard.php');
      });
    } catch (error) {
      console.error('Admin registration error:', error);

      return res.render('admin_register', {
        errors: ['Admin registration could not be completed.'],
        name,
        email
      });
    }
  }
);
// ----------------------------------------------------
// Password recovery
// ----------------------------------------------------

app.get(
  ['/forgot_password.php', '/forgot_password'],
  (req, res) => {
    return res.render('forgot_password', {
      errors: [],
      success: null,
      email: String(req.query.email || '')
    });
  }
);

app.post(
  ['/forgot_password.php', '/forgot_password'],
  async (req, res) => {
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();

    const genericMessage =
      'If the email is registered, password reset instructions ' +
      'will be sent shortly.';

    if (!email) {
      return res.render('forgot_password', {
        errors: ['Please enter your email address.'],
        success: null,
        email
      });
    }

    try {
      const emailResult =
        await validateEmailAuthenticity(email);

      if (!emailResult.isValid) {
        return res.render('forgot_password', {
          errors: ['Please enter a valid email address.'],
          success: null,
          email
        });
      }

      const user =
        await db.findUserByEmailOrUsername(email);

      // Do not reveal whether the account exists.
      if (user) {
        const otpData =
          await db.createPasswordResetOtp(email);

        await db.createNotification({
          userId: user.id,
          title: 'Password reset requested',
          message:
            'A password reset code was generated. ' +
            'It expires in 15 minutes.',
          type: 'system'
        });

        if (!isProduction) {
          console.warn(
            `[DEV] Password reset requested for ${email}. ` +
            'Use the configured development delivery mechanism.'
          );
        }

        // Never expose the OTP in the response.
        void otpData;
      }

      return res.render('forgot_password', {
        errors: [],
        success: genericMessage,
        email: ''
      });
    } catch (error) {
      console.error('Password recovery error:', error);

      return res.render('forgot_password', {
        errors: ['Unable to process the request right now.'],
        success: null,
        email
      });
    }
  }
);

app.get(
  ['/reset_password.php', '/reset_password'],
  (req, res) => {
    const email = String(req.query.email || '')
      .trim()
      .toLowerCase();

    if (!email) {
      return res.redirect('/forgot_password.php');
    }

    return res.render('reset_password', {
      email,
      otp: '',
      previewOtp: null,
      errors: [],
      success: null
    });
  }
);

app.post(
  ['/reset_password.php', '/reset_password'],
  async (req, res) => {
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const otp = String(req.body.otp || '').trim();
    const password = String(req.body.password || '');
    const confirmation = String(
      req.body.confirm_password || ''
    );

    const errors = [];

    if (!email || !/^\d{6}$/.test(otp)) {
      errors.push('Enter a valid six-digit OTP.');
    }

    if (password.length < 8) {
      errors.push('Password must be at least 8 characters.');
    }

    if (password !== confirmation) {
      errors.push('Passwords do not match.');
    }

    if (errors.length > 0) {
      return res.render('reset_password', {
        email,
        otp,
        previewOtp: null,
        errors,
        success: null
      });
    }

    try {
      const newPasswordHash =
        await bcrypt.hash(password, 12);

      // This method must verify and consume the OTP in one
      // database transaction.
      const updated =
        await db.updateUserPassword(
          email,
          newPasswordHash,
          otp
        );

      if (!updated) {
        return res.render('reset_password', {
          email,
          otp: '',
          previewOtp: null,
          errors: [
            'Invalid or expired OTP. Please request a new code.'
          ],
          success: null
        });
      }

      const user =
        await db.findUserByEmailOrUsername(email);

      if (user) {
        setAuthSession(req, res, {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone || '',
          whatsapp_number:
            user.whatsapp_number || user.phone || '',
          is_admin: user.is_admin ? 1 : 0
        });
      }

      return req.session.save(error => {
        if (error) {
          console.error('Password reset session error:', error);
          return res.status(500).send('Unable to create session.');
        }

        return res.redirect('/index.php?reset_success=1');
      });
    } catch (error) {
      console.error('Password reset error:', error);

      return res.render('reset_password', {
        email,
        otp: '',
        previewOtp: null,
        errors: ['Unable to reset the password right now.'],
        success: null
      });
    }
  }
);

// ----------------------------------------------------
// Seller product management
// ----------------------------------------------------

app.get(
  ['/my_products.php', '/my_products', '/seller/products'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.redirect('/login.php?return=/my_products.php');
    }

    try {
      const sellerId = req.session.user_id;
      const products = await db.getProductsBySeller(sellerId);
      const pendingRequests =
        await db.getPendingPriceChangeRequestsForSeller(
          sellerId
        );

      const feedback = req.session.sellerFeedback || null;
      delete req.session.sellerFeedback;

      return res.render('my_products', {
        products,
        pendingRequests,
        feedback
      });
    } catch (error) {
      console.error('Error loading seller products:', error);
      return res.status(500).send('Internal Server Error');
    }
  }
);

app.post(
  ['/seller/update-price', '/my_products/update-price'],
  async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.redirect('/login.php?return=/my_products.php');
    }

    const productId = parsePositiveInteger(req.body.product_id);
    const price = Number.parseFloat(req.body.price);
    const quantity =
      req.body.quantity === undefined
        ? null
        : parseNonNegativeInteger(req.body.quantity);

    if (!productId || !Number.isFinite(price) || price <= 0) {
      req.session.sellerFeedback = {
        type: 'error',
        message: 'Enter a valid product and positive price.'
      };

      return req.session.save(() =>
        res.redirect('/my_products.php')
      );
    }

    const result =
      await db.updateProductPriceBySeller(
        productId,
        req.session.user_id,
        price,
        quantity
      );

    req.session.sellerFeedback = {
      type: result.success ? 'success' : 'error',
      message: result.success
        ? `Listing updated. Price: UGX ${Number(
            result.newPrice
          ).toLocaleString()}.`
        : result.error || 'Unable to update listing.'
    };

    return req.session.save(() =>
      res.redirect('/my_products.php')
    );
  }
);
