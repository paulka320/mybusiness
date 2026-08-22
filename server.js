const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;

// Ensure upload directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName = Date.now() + '-' + file.fieldname + '-' + file.originalname.replace(/[^A-Za-z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (['jpg', 'jpeg', 'png', 'webp', 'svg'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('All images must be JPG, PNG, WEBP or SVG.'));
    }
  }
});

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use(session({
  secret: process.env.SESSION_SECRET || 'easymarket_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Pass user object to all templates
app.use((req, res, next) => {
  res.locals.user = req.session && req.session.user_id ? {
    id: req.session.user_id,
    name: req.session.user_name,
    email: req.session.user_email,
    is_admin: req.session.is_admin
  } : null;
  next();
});

// --- IN-MEMORY DATABASE ---
let categories = [
  { id: 1, name: 'Electronics', created_at: new Date('2026-01-01') },
  { id: 2, name: 'Fashion', created_at: new Date('2026-01-01') },
  { id: 3, name: 'Home & Garden', created_at: new Date('2026-01-01') },
  { id: 4, name: 'Vehicles', created_at: new Date('2026-01-01') }
];

let products = [
  {
    id: 1,
    title: 'iPhone 13 Pro 128GB',
    description: 'Graphite color in pristine condition. Battery health 94%. Comes with fast charger and protective case.',
    price: 2400000,
    image: 'phone-front.svg',
    category_id: 1,
    location: 'Kampala, Central',
    phone: '+256 701 234567',
    payment_code: 'MTN-88329',
    approved: 1,
    quantity: 5,
    created_at: new Date('2026-02-15T10:00:00Z')
  },
  {
    id: 2,
    title: "Men's Classic Leather Jacket",
    description: 'Genuine cowhide leather biker jacket. Warm fleece interior lining, durable heavy-duty brass zippers.',
    price: 180000,
    image: 'jacket.svg',
    category_id: 2,
    location: 'Entebbe, Wakiso',
    phone: '+256 772 345678',
    payment_code: 'AIRTEL-4491',
    approved: 1,
    quantity: 12,
    created_at: new Date('2026-02-16T11:30:00Z')
  },
  {
    id: 3,
    title: 'Modern Oak Coffee Table',
    description: 'Handcrafted solid oak wood coffee table with powder-coated steel hairpin legs. Perfect for modern living rooms.',
    price: 350000,
    image: 'table.svg',
    category_id: 3,
    location: 'Jinja',
    phone: '+256 753 456789',
    payment_code: 'MTN-12094',
    approved: 1,
    quantity: 3,
    created_at: new Date('2026-02-17T14:15:00Z')
  },
  {
    id: 4,
    title: 'Toyota Harrier 2018 Edition',
    description: 'Clean automatic SUV, 2000cc petrol engine, leather seats, panoramic sunroof, excellent fuel economy.',
    price: 68000000,
    image: 'car.svg',
    category_id: 4,
    location: 'Kampala, Nakawa',
    phone: '+256 784 567890',
    payment_code: 'AIRTEL-9921',
    approved: 1,
    quantity: 1,
    created_at: new Date('2026-02-18T09:00:00Z')
  },
  {
    id: 5,
    title: 'Samsung Galaxy S22 Ultra 256GB',
    description: 'Phantom Black with integrated S-Pen stylus. 108MP camera with 100x Space Zoom, flawless OLED display.',
    price: 2100000,
    image: 'galaxy.svg',
    category_id: 1,
    location: 'Mukono',
    phone: '+256 705 678901',
    payment_code: 'MTN-55671',
    approved: 1,
    quantity: 4,
    created_at: new Date('2026-02-19T16:45:00Z')
  }
];

let product_images = [
  { id: 1, product_id: 1, image_path: 'phone-front.svg', is_main: 1 },
  { id: 2, product_id: 1, image_path: 'phone-back.svg', is_main: 0 },
  { id: 3, product_id: 1, image_path: 'phone-left.svg', is_main: 0 },
  { id: 4, product_id: 1, image_path: 'phone-right.svg', is_main: 0 },
  { id: 5, product_id: 1, image_path: 'phone-top.svg', is_main: 0 },
  { id: 6, product_id: 2, image_path: 'jacket.svg', is_main: 1 },
  { id: 7, product_id: 3, image_path: 'table.svg', is_main: 1 },
  { id: 8, product_id: 4, image_path: 'car.svg', is_main: 1 },
  { id: 9, product_id: 5, image_path: 'galaxy.svg', is_main: 1 }
];

const defaultPasswordHash = bcrypt.hashSync('password123', 10);
const adminPasswordHash = bcrypt.hashSync('adminpassword', 10);

let users = [
  { id: 1, name: 'Paul', email: 'paul@example.com', password_hash: defaultPasswordHash, is_admin: 0, created_at: new Date('2026-01-01') },
  { id: 2, name: 'Admin', email: 'admin@easymarket.ug', password_hash: adminPasswordHash, is_admin: 1, created_at: new Date('2026-01-01') }
];

let orders = [
  {
    id: 101,
    user_id: 1,
    total: 2400000,
    status: 'Pending',
    address: 'Plot 14, Kampala Road, Kampala',
    phone: '+256 701 234567',
    payment_reference: 'MTN-MM-982143',
    created_at: new Date('2026-02-20T12:00:00Z'),
    items: [
      {
        id: 1,
        order_id: 101,
        product_id: 1,
        title: 'iPhone 13 Pro 128GB',
        price: 2400000,
        quantity: 1,
        image: 'phone-front.svg'
      }
    ]
  }
];

let nextProductId = 6;
let nextImageId = 10;
let nextUserId = 3;
let nextOrderId = 102;
let nextOrderItemId = 2;

// Helpers
function getProductsWithCategories(filterFn) {
  let list = products.map(p => {
    const cat = categories.find(c => c.id === p.category_id);
    return {
      ...p,
      category_name: cat ? cat.name : 'General'
    };
  });
  if (filterFn) {
    list = list.filter(filterFn);
  }
  return list;
}

// --- ROUTES ---

// 1. Home / Index
app.get(['/', '/index.php', '/index'], (req, res) => {
  const search = (req.query.search || '').trim().toLowerCase();
  const categorySelected = parseInt(req.query.category_id, 10) || 0;
  const minPrice = parseFloat(req.query.price_min) || 0;
  const maxPrice = parseFloat(req.query.price_max) || 0;
  const sort = req.query.sort || 'newest';

  let filtered = getProductsWithCategories(p => p.approved === 1 && p.quantity > 0);

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
    sort
  });
});

// 2. Category page
app.get(['/category.php', '/category'], (req, res) => {
  const id = parseInt(req.query.id, 10) || 0;
  const category = categories.find(c => c.id === id);
  if (!category) {
    return res.redirect('index.php');
  }

  const search = (req.query.search || '').trim().toLowerCase();
  const sort = req.query.sort || 'newest';

  let filtered = getProductsWithCategories(p => p.category_id === id && p.approved === 1 && p.quantity > 0);

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
});

// 3. Product Details
app.get(['/product.php', '/product'], (req, res) => {
  const id = parseInt(req.query.id, 10) || 0;
  const prod = products.find(p => p.id === id && p.approved === 1 && p.quantity > 0);
  if (!prod) {
    return res.redirect('index.php');
  }

  const cat = categories.find(c => c.id === prod.category_id);
  const product = { ...prod, category_name: cat ? cat.name : 'General' };

  const images = product_images
    .filter(img => img.product_id === id)
    .sort((a, b) => (b.is_main || 0) - (a.is_main || 0) || a.id - b.id);

  const similar = getProductsWithCategories(p => p.category_id === product.category_id && p.id !== id && p.approved === 1)
    .slice(0, 4);

  res.render('product', {
    product,
    images,
    similar
  });
});

// 4. Cart
app.get(['/cart.php', '/cart'], (req, res) => {
  res.render('cart');
});

// 5. Checkout
app.get(['/checkout.php', '/checkout'], (req, res) => {
  if (!req.session.user_id) {
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

app.post(['/checkout.php', '/checkout'], (req, res) => {
  if (!req.session.user_id) {
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
  } catch (e) {
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
        errors.push('Cart contains invalid product quantities or product references.');
        break;
      }

      const prod = products.find(p => p.id === productId && p.approved === 1);
      if (!prod) {
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

  const orderId = nextOrderId++;
  const orderItemsList = validatedItems.map(item => ({
    id: nextOrderItemId++,
    order_id: orderId,
    product_id: item.product_id,
    title: item.title,
    price: item.price,
    quantity: item.quantity,
    image: item.image
  }));

  // Deduct stock quantities
  for (const item of validatedItems) {
    const prod = products.find(p => p.id === item.product_id);
    if (prod) {
      prod.quantity = Math.max(0, prod.quantity - item.quantity);
      if (prod.quantity <= 0) {
        prod.approved = 0;
      }
    }
  }

  orders.unshift({
    id: orderId,
    user_id: req.session.user_id,
    total: total,
    status: 'Pending',
    address: address,
    phone: phone,
    payment_reference: paymentReference,
    created_at: new Date(),
    items: orderItemsList
  });

  res.render('checkout', {
    errors: [],
    success: `Your order has been placed successfully. Order #${orderId} is now pending.`,
    address: '',
    phone: '',
    payment_reference: ''
  });
});

// 6. Orders
app.get(['/orders.php', '/orders'], (req, res) => {
  if (!req.session.user_id) {
    return res.redirect('login.php?return=orders.php');
  }

  const userOrders = orders
    .filter(o => o.user_id === req.session.user_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.render('orders', {
    orders: userOrders
  });
});

// 7. Upload / Sell Product
const uploadFields = upload.fields([
  { name: 'front_image', maxCount: 1 },
  { name: 'back_image', maxCount: 1 },
  { name: 'left_image', maxCount: 1 },
  { name: 'right_image', maxCount: 1 },
  { name: 'top_image', maxCount: 1 }
]);

app.get(['/upload.php', '/upload'], (req, res) => {
  if (!req.session.user_id) {
    return res.redirect('login.php?return=upload.php');
  }
  res.render('upload', {
    categories,
    errors: [],
    success: null,
    formData: {}
  });
});

app.post(['/upload.php', '/upload'], uploadFields, (req, res) => {
  if (!req.session.user_id) {
    return res.redirect('login.php?return=upload.php');
  }

  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const price = parseFloat(req.body.price) || 0;
  const quantity = parseInt(req.body.quantity, 10) || 0;
  const category = parseInt(req.body.category, 10) || 0;
  const phone = (req.body.phone || '').trim();
  const location = (req.body.location || '').trim();
  const payment = (req.body.payment || '').trim();

  const errors = [];
  if (!title) errors.push('Product title is required.');
  if (price <= 0) errors.push('Enter a valid price.');
  if (quantity < 0) errors.push('Quantity cannot be negative.');
  if (!category) errors.push('Select a category.');

  const angleNames = ['front_image', 'back_image', 'left_image', 'right_image', 'top_image'];
  const uploadedFiles = [];

  for (const field of angleNames) {
    if (!req.files || !req.files[field] || req.files[field].length === 0) {
      errors.push(`Please upload the ${field.replace('_', ' ')} image.`);
    } else {
      uploadedFiles.push(req.files[field][0].filename);
    }
  }

  if (errors.length > 0) {
    return res.render('upload', {
      categories,
      errors,
      success: null,
      formData: req.body
    });
  }

  const newProdId = nextProductId++;
  const mainImg = uploadedFiles[0];

  products.unshift({
    id: newProdId,
    title,
    description,
    price,
    category_id: category,
    phone,
    location,
    image: mainImg,
    payment_code: payment,
    quantity,
    approved: 1,
    created_at: new Date()
  });

  uploadedFiles.forEach((file, index) => {
    product_images.push({
      id: nextImageId++,
      product_id: newProdId,
      image_path: file,
      is_main: index === 0 ? 1 : 0
    });
  });

  res.render('upload', {
    categories,
    errors: [],
    success: `Product uploaded successfully with ${uploadedFiles.length} images and is now live on EasyMarket.`,
    formData: {}
  });
});

// 8. Auth: Login
app.get(['/login.php', '/login'], (req, res) => {
  if (req.session.user_id) {
    return res.redirect('index.php');
  }
  let returnUrl = req.query.return || 'index.php';
  if (returnUrl.includes('://') || returnUrl.includes('..')) {
    returnUrl = 'index.php';
  }
  res.render('login', {
    returnUrl,
    errors: [],
    email: ''
  });
});

app.post(['/login.php', '/login'], (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  let returnUrl = req.body.return || 'index.php';
  if (returnUrl.includes('://') || returnUrl.includes('..')) {
    returnUrl = 'index.php';
  }

  const errors = [];
  if (!email || !password) {
    errors.push('Enter both email and password.');
  }

  if (errors.length === 0) {
    const user = users.find(u => u.email.toLowerCase() === email);
    if (user && bcrypt.compareSync(password, user.password_hash)) {
      req.session.user_id = user.id;
      req.session.user_name = user.name;
      req.session.user_email = user.email;
      req.session.is_admin = user.is_admin;
      return res.redirect(returnUrl);
    }
    errors.push('Login failed. Please check your email and password.');
  }

  res.render('login', {
    returnUrl,
    errors,
    email
  });
});

// 9. Auth: Register
app.get(['/register.php', '/register'], (req, res) => {
  if (req.session.user_id) {
    return res.redirect('index.php');
  }
  res.render('register', {
    errors: [],
    name: '',
    email: ''
  });
});

app.post(['/register.php', '/register'], (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';

  const errors = [];
  if (!name || !email || !password || !confirm) {
    errors.push('All fields are required.');
  }
  if (!email.includes('@') || !email.includes('.')) {
    errors.push('Enter a valid email address.');
  }
  if (password !== confirm) {
    errors.push('Passwords do not match.');
  }
  if (password.length < 6) {
    errors.push('Password should be at least 6 characters.');
  }

  if (errors.length === 0) {
    const existing = users.find(u => u.email.toLowerCase() === email);
    if (existing) {
      errors.push('This email is already registered.');
    }
  }

  if (errors.length > 0) {
    return res.render('register', {
      errors,
      name,
      email
    });
  }

  const newId = nextUserId++;
  const hash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: newId,
    name,
    email,
    password_hash: hash,
    is_admin: 0,
    created_at: new Date()
  };
  users.push(newUser);

  req.session.user_id = newId;
  req.session.user_name = name;
  req.session.user_email = email;
  req.session.is_admin = 0;

  res.redirect('index.php');
});

// 10. Admin Auth: Login
app.get(['/admin_login.php', '/admin_login'], (req, res) => {
  if (req.session.user_id && req.session.is_admin === 1) {
    return res.redirect('admin_dashboard.php');
  }
  res.render('admin_login', {
    errors: [],
    email: ''
  });
});

app.post(['/admin_login.php', '/admin_login'], (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const errors = [];
  if (!email || !password) {
    errors.push('Enter both email and password.');
  }

  if (errors.length === 0) {
    const user = users.find(u => u.email.toLowerCase() === email && u.is_admin === 1);
    if (user && bcrypt.compareSync(password, user.password_hash)) {
      req.session.user_id = user.id;
      req.session.user_name = user.name;
      req.session.user_email = user.email;
      req.session.is_admin = 1;
      return res.redirect('admin_dashboard.php');
    }
    errors.push('Invalid admin credentials.');
  }

  res.render('admin_login', {
    errors,
    email
  });
});

// 11. Admin Auth: Register
app.get(['/admin_register.php', '/admin_register'], (req, res) => {
  if (req.session.user_id) {
    return res.redirect('index.php');
  }
  res.render('admin_register', {
    errors: [],
    name: '',
    email: ''
  });
});

app.post(['/admin_register.php', '/admin_register'], (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';
  const adminCode = (req.body.admin_code || '').trim();

  const errors = [];
  if (!name || !email || !password || !confirm) {
    errors.push('All fields are required.');
  }
  if (!email.includes('@') || !email.includes('.')) {
    errors.push('Enter a valid email address.');
  }
  if (password !== confirm) {
    errors.push('Passwords do not match.');
  }
  if (password.length < 6) {
    errors.push('Password should be at least 6 characters.');
  }
  if (adminCode !== 'ADMIN2026') {
    errors.push('Invalid admin code.');
  }

  if (errors.length === 0) {
    const existing = users.find(u => u.email.toLowerCase() === email);
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

  const newId = nextUserId++;
  const hash = bcrypt.hashSync(password, 10);
  const newAdmin = {
    id: newId,
    name,
    email,
    password_hash: hash,
    is_admin: 1,
    created_at: new Date()
  };
  users.push(newAdmin);

  req.session.user_id = newId;
  req.session.user_name = name;
  req.session.user_email = email;
  req.session.is_admin = 1;

  res.redirect('admin_dashboard.php');
});

// 12. Admin Dashboard
app.get(['/admin_dashboard.php', '/admin_dashboard'], (req, res) => {
  if (!req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('admin_login.php');
  }

  const allProducts = getProductsWithCategories().sort((a, b) => b.id - a.id);
  res.render('admin_dashboard', {
    products: allProducts
  });
});

app.post(['/admin_dashboard.php', '/admin_dashboard'], (req, res) => {
  if (!req.session.user_id || req.session.is_admin !== 1) {
    return res.redirect('admin_login.php');
  }

  const productId = parseInt(req.body.product_id, 10);
  if (req.body.update_quantity) {
    const newQty = parseInt(req.body.quantity, 10) || 0;
    const prod = products.find(p => p.id === productId);
    if (prod) {
      prod.quantity = Math.max(0, newQty);
      prod.approved = prod.quantity > 0 ? 1 : 0;
    }
  } else if (req.body.delete_product) {
    products = products.filter(p => p.id !== productId);
    product_images = product_images.filter(img => img.product_id !== productId);
  }

  res.redirect('admin_dashboard.php');
});

// 13. Logout
app.get(['/logout.php', '/logout'], (req, res) => {
  req.session.destroy(() => {
    res.redirect('index.php');
  });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`EasyMarket server running on http://0.0.0.0:${PORT}`);
});
