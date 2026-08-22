const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const ADMIN_USERNAME = 'EasyMarket@admin123easymarket';
const ADMIN_PASSWORD = '@@!!easymarketadmin!@';

// Database connection string support (Supabase, Neon, PostgreSQL, Railway, etc.)
const connectionString = process.env.DATABASE_URL || 
                         process.env.POSTGRES_URL || 
                         process.env.SUPABASE_DB_URL || 
                         process.env.PG_CONNECTION_STRING;

let pool = null;
let isConnectedToPostgres = false;

if (connectionString || process.env.PGHOST) {
  try {
    pool = new Pool({
      connectionString: connectionString || undefined,
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      ssl: (connectionString && connectionString.includes('sslmode=disable')) ? false : { rejectUnauthorized: false }
    });
    console.log('PostgreSQL/Supabase pool initialized.');
  } catch (err) {
    console.error('Error initializing PostgreSQL pool:', err.message);
    pool = null;
  }
}

// In-Memory fallback store
const adminPasswordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const defaultPasswordHash = bcrypt.hashSync('password123', 10);

let memCategories = [
  { id: 1, name: 'Electronics' },
  { id: 2, name: 'Fashion' },
  { id: 3, name: 'Home & Garden' },
  { id: 4, name: 'Vehicles' }
];

let memProducts = [
  {
    id: 1,
    title: 'iPhone 13 Pro 128GB',
    description: 'Graphite color in pristine condition. Battery health 94%. Comes with fast charger and protective case.',
    price: 2400000,
    image: 'phone-front.svg',
    category_id: 1,
    location: 'Kampala, Central',
    phone: '+256 701 234567',
    whatsapp_number: '256701234567',
    has_whatsapp: true,
    payment_code: 'MTN-88329',
    approved: 1,
    quantity: 5,
    seller_id: 2,
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
    whatsapp_number: '256772345678',
    has_whatsapp: true,
    payment_code: 'AIRTEL-4491',
    approved: 1,
    quantity: 12,
    seller_id: 1,
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
    whatsapp_number: '256753456789',
    has_whatsapp: true,
    payment_code: 'MTN-12094',
    approved: 1,
    quantity: 2, // Low stock <= 3
    seller_id: 1,
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
    whatsapp_number: '256784567890',
    has_whatsapp: true,
    payment_code: 'AIRTEL-9921',
    approved: 1,
    quantity: 1, // Low stock <= 3
    seller_id: 2,
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
    whatsapp_number: '256705678901',
    has_whatsapp: true,
    payment_code: 'MTN-55671',
    approved: 1,
    quantity: 4,
    seller_id: 2,
    created_at: new Date('2026-02-19T16:45:00Z')
  }
];

let memProductImages = [
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

let memUsers = [
  { 
    id: 1, 
    name: 'Paul Mukasa', 
    email: 'paul@example.com', 
    password_hash: defaultPasswordHash, 
    is_admin: 0, 
    phone: '+256 701 234567', 
    whatsapp_number: '256701234567', 
    has_whatsapp: true,
    created_at: new Date('2026-01-01') 
  },
  { 
    id: 2, 
    name: 'EasyMarket Admin', 
    email: ADMIN_USERNAME.toLowerCase(), 
    password_hash: adminPasswordHash, 
    is_admin: 1, 
    phone: '+256 763 480495', 
    whatsapp_number: '256763480495', 
    has_whatsapp: true,
    created_at: new Date('2026-01-01') 
  }
];

let memOrders = [
  {
    id: 101,
    user_id: 1,
    total: 2400000,
    status: 'Delivered',
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
  },
  {
    id: 102,
    user_id: 1,
    total: 180000,
    status: 'Pending',
    address: 'Plot 14, Kampala Road, Kampala',
    phone: '+256 701 234567',
    payment_reference: 'AIRTEL-MM-114920',
    created_at: new Date('2026-02-22T08:30:00Z'),
    items: [
      {
        id: 2,
        order_id: 102,
        product_id: 2,
        title: "Men's Classic Leather Jacket",
        price: 180000,
        quantity: 1,
        image: 'jacket.svg'
      }
    ]
  }
];

let memNotifications = [
  {
    id: 1,
    user_id: 1,
    title: '🛡️ Marketplace Authenticity Agreement',
    message: 'Welcome to EasyMarket! Your account is activated under the 10-point anti-deception rules. Genuine listings protect our Uganda community.',
    type: 'integrity_warning',
    is_read: 0,
    created_at: new Date()
  },
  {
    id: 2,
    user_id: 1,
    title: '🚚 Order #101 Delivered',
    message: 'Your order for iPhone 13 Pro 128GB has been successfully delivered. Thank you for shopping on EasyMarket!',
    type: 'order_status',
    is_read: 1,
    created_at: new Date('2026-02-20T16:00:00Z')
  }
];

let memMessages = [
  {
    id: 1,
    sender_id: 1,
    receiver_id: 2,
    product_id: 1,
    message: 'Hello, is the iPhone 13 Pro available for immediate delivery to Kampala Road today?',
    is_read: 1,
    created_at: new Date('2026-02-20T10:15:00Z')
  },
  {
    id: 2,
    sender_id: 2,
    receiver_id: 1,
    product_id: 1,
    message: 'Yes Paul, it is in stock with 94% battery health! Our dispatch rider can reach you within 2 hours.',
    is_read: 1,
    created_at: new Date('2026-02-20T10:20:00Z')
  }
];

let memSupportTickets = [
  {
    id: 1,
    user_id: 1,
    user_name: 'Paul Mukasa',
    user_email: 'paul@example.com',
    subject: 'Delivery inquiry for Jinja address',
    message: 'Do you offer same-day courier dispatch to Jinja town for furniture items?',
    status: 'Open',
    admin_reply: '',
    created_at: new Date('2026-02-21T09:00:00Z'),
    updated_at: new Date('2026-02-21T09:00:00Z')
  }
];

let memReturnsRefunds = [
  {
    id: 1,
    order_id: 101,
    user_id: 1,
    user_name: 'Paul Mukasa',
    product_title: 'iPhone 13 Pro 128GB',
    reason: 'Incorrect case accessory color in package',
    amount: 50000,
    status: 'Pending',
    admin_note: '',
    created_at: new Date('2026-02-21T14:00:00Z')
  }
];

let memCampaigns = [
  {
    id: 1,
    name: 'Kampala Free Delivery Week',
    code: 'KLAFREE',
    discount_percent: 10,
    status: 'Active',
    clicks: 1420,
    conversions: 89,
    start_date: '2026-02-15',
    end_date: '2026-02-28'
  },
  {
    id: 2,
    name: 'Tech Bonanza Festival',
    code: 'TECH50',
    discount_percent: 15,
    status: 'Active',
    clicks: 850,
    conversions: 54,
    start_date: '2026-02-01',
    end_date: '2026-03-01'
  }
];

let memNextProdId = 6;
let memNextImgId = 10;
let memNextUserId = 3;
let memNextOrderId = 103;
let memNextOrderItemId = 3;
let memNextNotifId = 3;
let memNextMsgId = 3;
let memNextTicketId = 2;
let memNextReturnId = 2;
let memNextCampaignId = 3;

// Initialize Supabase/PostgreSQL schema
async function initDatabase() {
  if (!pool) return;

  try {
    const client = await pool.connect();
    try {
      console.log('Testing Supabase / PostgreSQL connection...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          phone VARCHAR(100),
          whatsapp_number VARCHAR(100),
          has_whatsapp BOOLEAN DEFAULT TRUE,
          is_admin INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          price NUMERIC(15,2) NOT NULL DEFAULT 0,
          image VARCHAR(255),
          category_id INT REFERENCES categories(id) ON DELETE SET NULL,
          location VARCHAR(255),
          phone VARCHAR(100),
          whatsapp_number VARCHAR(100),
          payment_code VARCHAR(100),
          approved INT DEFAULT 1,
          quantity INT DEFAULT 1,
          seller_id INT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS product_images (
          id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(id) ON DELETE CASCADE,
          image_path VARCHAR(255) NOT NULL,
          is_main INT DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE SET NULL,
          total NUMERIC(15,2) NOT NULL DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Pending',
          address TEXT,
          phone VARCHAR(100),
          payment_reference VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INT REFERENCES orders(id) ON DELETE CASCADE,
          product_id INT,
          title VARCHAR(255) NOT NULL,
          price NUMERIC(15,2) NOT NULL,
          quantity INT NOT NULL DEFAULT 1,
          image VARCHAR(255)
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'system',
          is_read INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          sender_id INT REFERENCES users(id) ON DELETE CASCADE,
          receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
          product_id INT REFERENCES products(id) ON DELETE SET NULL,
          message TEXT NOT NULL,
          is_read INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE SET NULL,
          user_name VARCHAR(255),
          user_email VARCHAR(255),
          subject VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          status VARCHAR(50) DEFAULT 'Open',
          admin_reply TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS returns_refunds (
          id SERIAL PRIMARY KEY,
          order_id INT REFERENCES orders(id) ON DELETE CASCADE,
          user_id INT REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NOT NULL,
          amount NUMERIC(15,2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Pending',
          admin_note TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS campaigns (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(50) NOT NULL,
          discount_percent INT DEFAULT 10,
          status VARCHAR(50) DEFAULT 'Active',
          clicks INT DEFAULT 0,
          conversions INT DEFAULT 0,
          start_date VARCHAR(50),
          end_date VARCHAR(50)
        );
      `);

      // Seed categories if empty
      const catCountRes = await client.query('SELECT COUNT(*) FROM categories');
      if (parseInt(catCountRes.rows[0].count, 10) === 0) {
        for (const cat of memCategories) {
          await client.query('INSERT INTO categories (id, name) VALUES ($1, $2)', [cat.id, cat.name]);
        }
        await client.query("SELECT setval('categories_id_seq', (SELECT MAX(id) FROM categories))");
      }

      // Seed products if empty
      const prodCountRes = await client.query('SELECT COUNT(*) FROM products');
      if (parseInt(prodCountRes.rows[0].count, 10) === 0) {
        for (const p of memProducts) {
          await client.query(
            'INSERT INTO products (id, title, description, price, image, category_id, location, phone, whatsapp_number, payment_code, approved, quantity, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
            [p.id, p.title, p.description, p.price, p.image, p.category_id, p.location, p.phone, p.whatsapp_number, p.payment_code, p.approved, p.quantity, p.created_at]
          );
        }
        await client.query("SELECT setval('products_id_seq', (SELECT MAX(id) FROM products))");
      }

      // Seed admin user
      const userRes = await client.query('SELECT * FROM users WHERE LOWER(email) = $1', [ADMIN_USERNAME.toLowerCase()]);
      if (userRes.rows.length === 0) {
        await client.query(
          'INSERT INTO users (name, email, password_hash, is_admin, phone, whatsapp_number) VALUES ($1, $2, $3, $4, $5, $6)',
          ['EasyMarket Admin', ADMIN_USERNAME.toLowerCase(), adminPasswordHash, 1, '+256 763 480495', '256763480495']
        );
      }

      isConnectedToPostgres = true;
      console.log('✅ PostgreSQL / Supabase Database Connected & Synchronized Successfully!');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('Could not connect to PostgreSQL server. Falling back to in-memory store:', err.message);
    isConnectedToPostgres = false;
  }
}

// Format Uganda WhatsApp phone number cleanly (e.g. "+256 701 234567" or "0701234567" -> "256701234567")
function sanitizeWhatsAppNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '256' + cleaned.substring(1);
  } else if (!cleaned.startsWith('256') && cleaned.length === 9) {
    cleaned = '256' + cleaned;
  }
  return cleaned;
}

const db = {
  sanitizeWhatsAppNumber,

  async getCategories() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM categories ORDER BY id ASC');
      return res.rows;
    }
    return memCategories;
  },

  async getCategoryById(id) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM categories WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return memCategories.find(c => c.id === id) || null;
  },

  async getProducts(filterFn = null) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        ORDER BY p.id DESC
      `);
      let list = res.rows.map(r => ({
        ...r,
        price: parseFloat(r.price),
        quantity: parseInt(r.quantity, 10),
        approved: parseInt(r.approved, 10)
      }));
      if (filterFn) {
        list = list.filter(filterFn);
      }
      return list;
    }
    let list = memProducts.map(p => {
      const cat = memCategories.find(c => c.id === p.category_id);
      return {
        ...p,
        category_name: cat ? cat.name : 'General'
      };
    });
    if (filterFn) {
      list = list.filter(filterFn);
    }
    return list;
  },

  async getProductById(id) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        WHERE p.id = $1
      `, [id]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        ...row,
        price: parseFloat(row.price),
        quantity: parseInt(row.quantity, 10),
        approved: parseInt(row.approved, 10)
      };
    }
    const p = memProducts.find(item => item.id === id);
    if (!p) return null;
    const cat = memCategories.find(c => c.id === p.category_id);
    return {
      ...p,
      category_name: cat ? cat.name : 'General'
    };
  },

  async getProductImages(productId) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_main DESC, id ASC', [productId]);
      return res.rows;
    }
    return memProductImages.filter(img => img.product_id === productId);
  },

  async getSimilarProducts(categoryId, currentId, limit = 4) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT * FROM products 
        WHERE category_id = $1 AND id != $2 AND approved = 1 AND quantity > 0
        ORDER BY id DESC LIMIT $3
      `, [categoryId, currentId, limit]);
      return res.rows.map(r => ({ ...r, price: parseFloat(r.price) }));
    }
    return memProducts
      .filter(p => p.category_id === categoryId && p.id !== currentId && p.approved === 1 && p.quantity > 0)
      .slice(0, limit);
  },

  async createProduct({ title, description, price, category_id, phone, whatsapp_number, location, payment_code, quantity, images, seller_id }) {
    const mainImage = (images && images.length > 0) ? images[0] : 'phone-front.svg';
    const wa = sanitizeWhatsAppNumber(whatsapp_number || phone);

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        INSERT INTO products (title, description, price, category_id, phone, whatsapp_number, location, image, payment_code, quantity, approved, seller_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)
        RETURNING id
      `, [title, description, price, category_id, phone, wa, location, mainImage, payment_code, quantity, seller_id || null]);
      
      const newProdId = res.rows[0].id;
      if (images && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          await pool.query(`
            INSERT INTO product_images (product_id, image_path, is_main)
            VALUES ($1, $2, $3)
          `, [newProdId, images[i], i === 0 ? 1 : 0]);
        }
      }
      return newProdId;
    }

    const newProdId = memNextProdId++;
    memProducts.unshift({
      id: newProdId,
      title,
      description,
      price,
      category_id,
      phone,
      whatsapp_number: wa,
      has_whatsapp: !!wa,
      location,
      image: mainImage,
      payment_code,
      quantity,
      approved: 1,
      seller_id: seller_id || 2,
      created_at: new Date()
    });

    images.forEach((file, index) => {
      memProductImages.push({
        id: memNextImgId++,
        product_id: newProdId,
        image_path: file,
        is_main: index === 0 ? 1 : 0
      });
    });

    return newProdId;
  },

  async quickUpdateProduct(productId, { title, price, quantity, approved }) {
    if (isConnectedToPostgres && pool) {
      await pool.query(`
        UPDATE products 
        SET title = COALESCE($1, title),
            price = COALESCE($2, price),
            quantity = COALESCE($3, quantity),
            approved = COALESCE($4, approved)
        WHERE id = $5
      `, [title || null, price || null, quantity !== undefined ? quantity : null, approved !== undefined ? approved : null, productId]);
      return;
    }

    const prod = memProducts.find(p => p.id === productId);
    if (prod) {
      if (title !== undefined) prod.title = title;
      if (price !== undefined) prod.price = parseFloat(price);
      if (quantity !== undefined) prod.quantity = Math.max(0, parseInt(quantity, 10));
      if (approved !== undefined) prod.approved = parseInt(approved, 10);
      if (prod.quantity === 0) prod.approved = 0;
    }
  },

  async updateProductQuantity(productId, quantity) {
    const approved = quantity > 0 ? 1 : 0;
    if (isConnectedToPostgres && pool) {
      await pool.query(
        'UPDATE products SET quantity = $1, approved = $2 WHERE id = $3',
        [quantity, approved, productId]
      );
      return;
    }
    const prod = memProducts.find(p => p.id === productId);
    if (prod) {
      prod.quantity = Math.max(0, quantity);
      prod.approved = approved;
    }
  },

  async deleteProduct(productId) {
    if (isConnectedToPostgres && pool) {
      await pool.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
      await pool.query('DELETE FROM products WHERE id = $1', [productId]);
      return;
    }
    memProducts = memProducts.filter(p => p.id !== productId);
    memProductImages = memProductImages.filter(img => img.product_id !== productId);
  },

  async findUserByEmailOrUsername(emailOrUsername) {
    const queryStr = (emailOrUsername || '').trim().toLowerCase();
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [queryStr]);
      return res.rows[0] || null;
    }
    return memUsers.find(u => u.email.toLowerCase() === queryStr) || null;
  },

  async findUserById(id) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return memUsers.find(u => u.id === id) || null;
  },

  async createUser(name, email, passwordHash, isAdmin = 0, phone = '', whatsappNumber = '') {
    const wa = sanitizeWhatsAppNumber(whatsappNumber || phone);
    const hasWa = !!wa;

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(
        'INSERT INTO users (name, email, password_hash, is_admin, phone, whatsapp_number, has_whatsapp) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [name, email.toLowerCase(), passwordHash, isAdmin, phone, wa, hasWa]
      );
      const user = res.rows[0];
      // Create initial welcome & integrity notification
      await this.createNotification({
        userId: user.id,
        title: '🛡️ Marketplace Integrity Agreement',
        message: 'Welcome to EasyMarket Uganda! Your account is active under the 10-point authenticity rules. Deceptive listings or fraudulent activities are strictly prohibited.',
        type: 'integrity_warning'
      });
      return user;
    }

    const newUser = {
      id: memNextUserId++,
      name,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      is_admin: isAdmin,
      phone,
      whatsapp_number: wa,
      has_whatsapp: hasWa,
      created_at: new Date()
    };
    memUsers.push(newUser);

    // Initial welcome notification
    this.createNotification({
      userId: newUser.id,
      title: '🛡️ Marketplace Integrity Agreement',
      message: 'Welcome to EasyMarket Uganda! Your account is active under the 10-point authenticity rules. Deceptive listings or fraudulent activities are strictly prohibited.',
      type: 'integrity_warning'
    });

    return newUser;
  },

  // Notification Methods
  async createNotification({ userId, title, message, type = 'system' }) {
    if (isConnectedToPostgres && pool) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, message, type, is_read) VALUES ($1, $2, $3, $4, 0)',
        [userId, title, message, type]
      );
      return;
    }
    memNotifications.unshift({
      id: memNextNotifId++,
      user_id: userId,
      title,
      message,
      type,
      is_read: 0,
      created_at: new Date()
    });
  },

  async getNotificationsByUser(userId) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
      return res.rows;
    }
    return memNotifications.filter(n => n.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async markNotificationAsRead(notificationId, userId) {
    if (isConnectedToPostgres && pool) {
      await pool.query('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [notificationId, userId]);
      return;
    }
    const notif = memNotifications.find(n => n.id === notificationId && n.user_id === userId);
    if (notif) notif.is_read = 1;
  },

  // Messaging System
  async sendMessage({ senderId, receiverId, productId, message }) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, product_id, message, is_read) VALUES ($1, $2, $3, $4, 0) RETURNING *',
        [senderId, receiverId, productId || null, message]
      );
      // Notify receiver
      const sender = await this.findUserById(senderId);
      await this.createNotification({
        userId: receiverId,
        title: `💬 New Message from ${sender ? sender.name : 'Customer'}`,
        message: message.length > 80 ? message.substring(0, 77) + '...' : message,
        type: 'message'
      });
      return res.rows[0];
    }

    const newMsg = {
      id: memNextMsgId++,
      sender_id: senderId,
      receiver_id: receiverId,
      product_id: productId || null,
      message,
      is_read: 0,
      created_at: new Date()
    };
    memMessages.push(newMsg);

    const sender = memUsers.find(u => u.id === senderId);
    this.createNotification({
      userId: receiverId,
      title: `💬 New Message from ${sender ? sender.name : 'Customer'}`,
      message: message.length > 80 ? message.substring(0, 77) + '...' : message,
      type: 'message'
    });

    return newMsg;
  },

  async getConversationsForUser(userId) {
    let allMsgs = [];
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT m.*, 
               s.name as sender_name, s.whatsapp_number as sender_whatsapp,
               r.name as receiver_name, r.whatsapp_number as receiver_whatsapp,
               p.title as product_title, p.image as product_image
        FROM messages m
        LEFT JOIN users s ON m.sender_id = s.id
        LEFT JOIN users r ON m.receiver_id = r.id
        LEFT JOIN products p ON m.product_id = p.id
        WHERE m.sender_id = $1 OR m.receiver_id = $1
        ORDER BY m.created_at ASC
      `, [userId]);
      allMsgs = res.rows;
    } else {
      allMsgs = memMessages
        .filter(m => m.sender_id === userId || m.receiver_id === userId)
        .map(m => {
          const sender = memUsers.find(u => u.id === m.sender_id);
          const receiver = memUsers.find(u => u.id === m.receiver_id);
          const prod = m.product_id ? memProducts.find(p => p.id === m.product_id) : null;
          return {
            ...m,
            sender_name: sender ? sender.name : 'User',
            sender_whatsapp: sender ? sender.whatsapp_number : '',
            receiver_name: receiver ? receiver.name : 'User',
            receiver_whatsapp: receiver ? receiver.whatsapp_number : '',
            product_title: prod ? prod.title : null,
            product_image: prod ? prod.image : null
          };
        });
    }

    // Group by counterparty
    const conversations = {};
    for (const msg of allMsgs) {
      const otherId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
      const otherName = msg.sender_id === userId ? msg.receiver_name : msg.sender_name;
      const otherWhatsApp = msg.sender_id === userId ? msg.receiver_whatsapp : msg.sender_whatsapp;

      if (!conversations[otherId]) {
        conversations[otherId] = {
          counterpartyId: otherId,
          counterpartyName: otherName || 'Customer',
          counterpartyWhatsApp: otherWhatsApp || '',
          productTitle: msg.product_title,
          productImage: msg.product_image,
          messages: [],
          lastMessage: '',
          lastTime: msg.created_at,
          unreadCount: 0
        };
      }
      conversations[otherId].messages.push(msg);
      conversations[otherId].lastMessage = msg.message;
      conversations[otherId].lastTime = msg.created_at;
      if (msg.receiver_id === userId && !msg.is_read) {
        conversations[otherId].unreadCount++;
      }
    }

    return Object.values(conversations).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  },

  async getMessagesBetweenUsers(userA, userB) {
    if (isConnectedToPostgres && pool) {
      await pool.query('UPDATE messages SET is_read = 1 WHERE sender_id = $1 AND receiver_id = $2', [userB, userA]);
      const res = await pool.query(`
        SELECT m.*, 
               s.name as sender_name,
               r.name as receiver_name,
               p.title as product_title, p.price as product_price, p.image as product_image
        FROM messages m
        LEFT JOIN users s ON m.sender_id = s.id
        LEFT JOIN users r ON m.receiver_id = r.id
        LEFT JOIN products p ON m.product_id = p.id
        WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
        ORDER BY m.created_at ASC
      `, [userA, userB]);
      return res.rows;
    }

    memMessages.forEach(m => {
      if (m.sender_id === userB && m.receiver_id === userA) {
        m.is_read = 1;
      }
    });

    return memMessages
      .filter(m => (m.sender_id === userA && m.receiver_id === userB) || (m.sender_id === userB && m.receiver_id === userA))
      .map(m => {
        const sender = memUsers.find(u => u.id === m.sender_id);
        const receiver = memUsers.find(u => u.id === m.receiver_id);
        const prod = m.product_id ? memProducts.find(p => p.id === m.product_id) : null;
        return {
          ...m,
          sender_name: sender ? sender.name : 'User',
          receiver_name: receiver ? receiver.name : 'User',
          product_title: prod ? prod.title : null,
          product_price: prod ? prod.price : null,
          product_image: prod ? prod.image : null
        };
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },

  // Orders and Fulfillment
  async createOrder({ userId, total, address, phone, paymentReference, items }) {
    if (isConnectedToPostgres && pool) {
      const orderRes = await pool.query(`
        INSERT INTO orders (user_id, total, status, address, phone, payment_reference)
        VALUES ($1, $2, 'Pending', $3, $4, $5)
        RETURNING id
      `, [userId, total, address, phone, paymentReference]);

      const orderId = orderRes.rows[0].id;
      for (const item of items) {
        await pool.query(`
          INSERT INTO order_items (order_id, product_id, title, price, quantity, image)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [orderId, item.product_id, item.title, item.price, item.quantity, item.image]);

        // Decrement stock
        await pool.query(`
          UPDATE products 
          SET quantity = GREATEST(0, quantity - $1),
              approved = CASE WHEN quantity - $1 <= 0 THEN 0 ELSE approved END
          WHERE id = $2
        `, [item.quantity, item.product_id]);
      }

      await this.createNotification({
        userId,
        title: `📦 Order #${orderId} Placed Successfully`,
        message: `Your order of UGX ${Number(total).toLocaleString()} has been received and is queued for fulfillment.`,
        type: 'order_status'
      });

      return orderId;
    }

    const orderId = memNextOrderId++;
    const orderItemsList = items.map(item => ({
      id: memNextOrderItemId++,
      order_id: orderId,
      product_id: item.product_id,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
      image: item.image
    }));

    for (const item of items) {
      const prod = memProducts.find(p => p.id === item.product_id);
      if (prod) {
        prod.quantity = Math.max(0, prod.quantity - item.quantity);
        if (prod.quantity <= 0) {
          prod.approved = 0;
        }
      }
    }

    memOrders.unshift({
      id: orderId,
      user_id: userId,
      total,
      status: 'Pending',
      address,
      phone,
      payment_reference: paymentReference,
      created_at: new Date(),
      items: orderItemsList
    });

    this.createNotification({
      userId,
      title: `📦 Order #${orderId} Placed Successfully`,
      message: `Your order of UGX ${Number(total).toLocaleString()} has been received and is queued for fulfillment.`,
      type: 'order_status'
    });

    return orderId;
  },

  async updateOrderStatus(orderId, status) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING user_id', [status, orderId]);
      if (res.rows.length > 0 && res.rows[0].user_id) {
        await this.createNotification({
          userId: res.rows[0].user_id,
          title: `🚚 Order #${orderId} Status: ${status}`,
          message: `Your order status has been updated to "${status}".`,
          type: 'order_status'
        });
      }
      return;
    }

    const ord = memOrders.find(o => o.id === orderId);
    if (ord) {
      ord.status = status;
      this.createNotification({
        userId: ord.user_id,
        title: `🚚 Order #${orderId} Status: ${status}`,
        message: `Your order status has been updated to "${status}".`,
        type: 'order_status'
      });
    }
  },

  async getAllOrders() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT o.*, u.name as user_name, u.email as user_email, u.whatsapp_number
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        ORDER BY o.created_at DESC
      `);
      const orders = res.rows;
      for (const ord of orders) {
        ord.total = parseFloat(ord.total);
        const itRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [ord.id]);
        ord.items = itRes.rows.map(it => ({ ...it, price: parseFloat(it.price) }));
      }
      return orders;
    }

    return memOrders.map(o => {
      const u = memUsers.find(usr => usr.id === o.user_id);
      return {
        ...o,
        user_name: u ? u.name : 'Guest User',
        user_email: u ? u.email : '',
        whatsapp_number: u ? u.whatsapp_number : ''
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async getOrdersByUser(userId) {
    if (isConnectedToPostgres && pool) {
      const ordersRes = await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      const userOrders = ordersRes.rows;
      for (const ord of userOrders) {
        ord.total = parseFloat(ord.total);
        const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [ord.id]);
        ord.items = itemsRes.rows.map(it => ({ ...it, price: parseFloat(it.price) }));
      }
      return userOrders;
    }

    return memOrders
      .filter(o => o.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Support Tickets
  async createSupportTicket({ userId, userName, userEmail, subject, message }) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        INSERT INTO support_tickets (user_id, user_name, user_email, subject, message, status)
        VALUES ($1, $2, $3, $4, $5, 'Open')
        RETURNING *
      `, [userId || null, userName, userEmail, subject, message]);
      return res.rows[0];
    }
    const newT = {
      id: memNextTicketId++,
      user_id: userId || null,
      user_name: userName,
      user_email: userEmail,
      subject,
      message,
      status: 'Open',
      admin_reply: '',
      created_at: new Date(),
      updated_at: new Date()
    };
    memSupportTickets.unshift(newT);
    return newT;
  },

  async getAllSupportTickets() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM support_tickets ORDER BY created_at DESC');
      return res.rows;
    }
    return memSupportTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async replySupportTicket(ticketId, reply, newStatus = 'Resolved') {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        UPDATE support_tickets 
        SET admin_reply = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $3 
        RETURNING *
      `, [reply, newStatus, ticketId]);
      const ticket = res.rows[0];
      if (ticket && ticket.user_id) {
        await this.createNotification({
          userId: ticket.user_id,
          title: `💬 Support Response: ${ticket.subject}`,
          message: reply,
          type: 'support'
        });
      }
      return ticket;
    }

    const t = memSupportTickets.find(item => item.id === ticketId);
    if (t) {
      t.admin_reply = reply;
      t.status = newStatus;
      t.updated_at = new Date();
      if (t.user_id) {
        this.createNotification({
          userId: t.user_id,
          title: `💬 Support Response: ${t.subject}`,
          message: reply,
          type: 'support'
        });
      }
      return t;
    }
    return null;
  },

  // Returns and Refunds
  async createReturnRefund({ orderId, userId, reason, amount }) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        INSERT INTO returns_refunds (order_id, user_id, reason, amount, status)
        VALUES ($1, $2, $3, $4, 'Pending')
        RETURNING *
      `, [orderId, userId, reason, amount]);
      return res.rows[0];
    }

    const ord = memOrders.find(o => o.id === orderId);
    const u = memUsers.find(usr => usr.id === userId);
    const newR = {
      id: memNextReturnId++,
      order_id: orderId,
      user_id: userId,
      user_name: u ? u.name : 'Customer',
      product_title: (ord && ord.items && ord.items[0]) ? ord.items[0].title : 'Order Item',
      reason,
      amount: amount || (ord ? ord.total : 0),
      status: 'Pending',
      admin_note: '',
      created_at: new Date()
    };
    memReturnsRefunds.unshift(newR);
    return newR;
  },

  async getAllReturnsRefunds() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT r.*, u.name as user_name, u.email as user_email, u.whatsapp_number
        FROM returns_refunds r
        LEFT JOIN users u ON r.user_id = u.id
        ORDER BY r.created_at DESC
      `);
      return res.rows.map(r => ({ ...r, amount: parseFloat(r.amount) }));
    }
    return memReturnsRefunds.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async updateReturnStatus(returnId, status, adminNote = '') {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        UPDATE returns_refunds 
        SET status = $1, admin_note = $2 
        WHERE id = $3 
        RETURNING *
      `, [status, adminNote, returnId]);
      const ret = res.rows[0];
      if (ret && ret.user_id) {
        await this.createNotification({
          userId: ret.user_id,
          title: `💸 Return/Refund #${returnId} Update`,
          message: `Your return request for Order #${ret.order_id} was marked "${status}". ${adminNote}`,
          type: 'refund'
        });
      }
      return ret;
    }

    const r = memReturnsRefunds.find(item => item.id === returnId);
    if (r) {
      r.status = status;
      r.admin_note = adminNote;
      if (r.user_id) {
        this.createNotification({
          userId: r.user_id,
          title: `💸 Return/Refund #${returnId} Update`,
          message: `Your return request for Order #${r.order_id} was marked "${status}". ${adminNote}`,
          type: 'refund'
        });
      }
      return r;
    }
    return null;
  },

  // Marketing & Campaigns
  async getAllCampaigns() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM campaigns ORDER BY id DESC');
      return res.rows;
    }
    return memCampaigns;
  },

  // Comprehensive System Analytics
  async getSystemStats() {
    const products = await this.getProducts();
    const orders = await this.getAllOrders();
    const tickets = await this.getAllSupportTickets();
    const returns = await this.getAllReturnsRefunds();
    const campaigns = await this.getAllCampaigns();

    const totalProducts = products.length;
    const activeProducts = products.filter(p => p.quantity > 0 && p.approved === 1).length;
    const lowStockProducts = products.filter(p => p.quantity > 0 && p.quantity <= 3);
    const outOfStockProducts = products.filter(p => p.quantity === 0);
    const totalStockUnits = products.reduce((sum, p) => sum + (p.quantity || 0), 0);
    const totalInventoryValue = products.reduce((sum, p) => sum + ((p.price || 0) * (p.quantity || 0)), 0);

    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'Pending').length;
    const processingOrders = orders.filter(o => o.status === 'Processing').length;
    const shippedOrders = orders.filter(o => o.status === 'Shipped').length;
    const deliveredOrders = orders.filter(o => o.status === 'Delivered').length;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled').length;
    
    const totalGrossSales = orders
      .filter(o => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);

    const averageOrderValue = totalOrders > 0 ? (totalGrossSales / totalOrders) : 0;
    // Estimated Conversion Rate based on 100 sessions per active campaign click baseline
    const estimatedVisitors = 1250 + (orders.length * 24);
    const conversionRate = totalOrders > 0 ? ((totalOrders / estimatedVisitors) * 100).toFixed(1) : '0.0';

    // Users and Buyer analytics
    const buyerSpendMap = {};
    orders.forEach(o => {
      const uid = o.user_id || 0;
      if (!buyerSpendMap[uid]) {
        buyerSpendMap[uid] = {
          userId: uid,
          userName: o.user_name || 'Customer',
          userEmail: o.user_email || '',
          whatsapp: o.whatsapp_number || o.phone || '',
          totalSpent: 0,
          orderCount: 0
        };
      }
      buyerSpendMap[uid].totalSpent += parseFloat(o.total) || 0;
      buyerSpendMap[uid].orderCount += 1;
    });

    const topBuyers = Object.values(buyerSpendMap)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 5);

    const returningBuyerCount = Object.values(buyerSpendMap).filter(b => b.orderCount > 1).length;
    const newBuyerCount = Math.max(0, Object.keys(buyerSpendMap).length - returningBuyerCount);

    const trafficSources = [
      { source: 'Direct & Mobile Web', percentage: 42, color: '#3b82f6' },
      { source: 'WhatsApp & Social Sharing', percentage: 31, color: '#22c55e' },
      { source: 'Google Search & SEO', percentage: 18, color: '#f59e0b' },
      { source: 'Merchant Referrals', percentage: 9, color: '#8b5cf6' }
    ];

    return {
      core: {
        totalGrossSales,
        totalOrders,
        averageOrderValue,
        conversionRate,
        estimatedVisitors
      },
      fulfillmentQueue: {
        pending: pendingOrders,
        processing: processingOrders,
        shipped: shippedOrders,
        delivered: deliveredOrders,
        cancelled: cancelledOrders,
        recentOrders: orders.slice(0, 10)
      },
      returns: {
        total: returns.length,
        pending: returns.filter(r => r.status === 'Pending').length,
        items: returns
      },
      inventory: {
        totalProducts,
        activeProducts,
        totalStockUnits,
        totalInventoryValue,
        lowStock: lowStockProducts,
        outOfStock: outOfStockProducts,
        allProducts: products
      },
      customerInsights: {
        newBuyers: newBuyerCount,
        returningBuyers: returningBuyerCount,
        topBuyers,
        supportTickets: tickets,
        openTicketsCount: tickets.filter(t => t.status === 'Open').length
      },
      marketing: {
        campaigns,
        trafficSources
      }
    };
  }
};

module.exports = { db, initDatabase };
