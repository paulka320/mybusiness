const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const ADMIN_USERNAME = 'EasyMarket@admin123easymarket';
const ADMIN_PASSWORD = '@@!!easymarketadmin!@';

const REGISTRATION_INTEGRITY_MESSAGE = 
  'Welcome to EasyMarket Uganda! As a member of our commerce community, you agree to uphold our 10-Point Marketplace Authenticity and Anti-Deception Policy: (1) Maintain honest and dependable communication. (2) Zero tolerance for counterfeit, false, or exaggerated claims. (3) 5-Angle photography must show real, current condition. (4) Keep stock quantities accurate. (5) Honor all pricing and payments. Violations will result in immediate suspension and blacklisting.';

// Persistent configuration storage for Supabase/PostgreSQL settings
const CONFIG_FILE_PATH = path.join(__dirname, '.supabase_config.json');

function loadSavedDbConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
      if (data && typeof data === 'object') {
        return data;
      }
    }
  } catch (e) {
    console.warn('Could not read saved database config:', e.message);
  }
  return {
    connectionString: (process.env.DATABASE_URL || 
                       process.env.POSTGRES_URL || 
                       process.env.SUPABASE_DB_URL || 
                       process.env.PG_CONNECTION_STRING || '').trim(),
    supabaseUrl: (process.env.SUPABASE_URL || 'https://ijizfozhorgaidgjonws.supabase.co').trim(),
    supabaseKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
  };
}

function saveDbConfigToDisk(cfg) {
  try {
    if (cfg && typeof cfg === 'object') {
      const existing = loadSavedDbConfig();
      const merged = { ...existing, ...cfg, savedAt: new Date().toISOString() };
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf8');
      return true;
    }
  } catch (e) {
    console.warn('Could not save database config to disk:', e.message);
  }
  return false;
}

const initialSavedConfig = loadSavedDbConfig();
let rawConnectionString = initialSavedConfig.connectionString || '';
let supabaseClientUrl = initialSavedConfig.supabaseUrl || 'https://ijizfozhorgaidgjonws.supabase.co';
let supabaseClientKey = initialSavedConfig.supabaseKey || '';
let supabaseJsClient = null;

let pool = null;
let isConnectedToPostgres = false;
let isConnectedToSupabaseJs = false;
let lastDbError = null;
let lastDbErrorCode = null;
let lastDbSuccessTime = null;
let lastDbHost = null;
let lastDbProjectRef = 'ijizfozhorgaidgjonws';

function parsePgConfig(connStr) {
  if (!connStr || typeof connStr !== 'string') return null;
  const trimmed = connStr.trim();
  if (!trimmed) return null;

  // Extract host, user, password, port, database cleanly even with complex passwords containing '@', '!', '?', '#', '%'
  // Standard format: postgresql://[user]:[password]@[host]:[port]/[database]
  const regex = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+)(?::(\d+))?\/(.*)$/;
  const match = trimmed.match(regex);
  if (match) {
    const [, user, rawPass, host, portStr, dbWithQuery] = match;
    const dbName = (dbWithQuery || 'postgres').split('?')[0];
    
    let decodedPass = rawPass;
    try {
      decodedPass = decodeURIComponent(rawPass);
    } catch {
      decodedPass = rawPass;
    }

    let decodedUser = user;
    try {
      decodedUser = decodeURIComponent(user);
    } catch {
      decodedUser = user;
    }

    const hostLower = host.toLowerCase();
    if (hostLower.includes('.supabase.co') || hostLower.includes('.supabase.com')) {
      const refMatch = hostLower.match(/db\.([a-z0-9]+)\.supabase\.co/i) || decodedUser.match(/postgres\.([a-z0-9]+)/i);
      if (refMatch && refMatch[1]) {
        lastDbProjectRef = refMatch[1];
      }
    }

    lastDbHost = host;

    return {
      user: decodedUser,
      password: decodedPass,
      host,
      port: portStr ? parseInt(portStr, 10) : 5432,
      database: dbName || 'postgres',
      ssl: trimmed.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 7000,
      query_timeout: 10000,
      idleTimeoutMillis: 30000,
      max: 10
    };
  }

  // Fallback direct string config
  return {
    connectionString: trimmed,
    ssl: trimmed.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 7000
  };
}

function initializePool(connStr) {
  const targetStr = connStr || rawConnectionString;
  if (!targetStr && !process.env.PGHOST) {
    pool = null;
    return;
  }

  try {
    const config = parsePgConfig(targetStr) || {
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 7000
    };

    if (pool) {
      try { pool.end(); } catch {}
    }

    pool = new Pool(config);
    rawConnectionString = targetStr;
    console.log('PostgreSQL / Supabase client pool initialized.');
  } catch (err) {
    console.error('Error initializing PostgreSQL pool:', err.message);
    pool = null;
    lastDbError = err.message;
  }
}

initializePool(rawConnectionString);

// In-Memory fallback store
const adminPasswordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

let memCategories = [
  { id: 1, name: 'Electronics' },
  { id: 2, name: 'Fashion' },
  { id: 3, name: 'Home & Garden' },
  { id: 4, name: 'Vehicles' }
];

let memProducts = [];
let memProductImages = [];

let memUsers = [
  { 
    id: 1, 
    name: 'EasyMarket Admin', 
    email: ADMIN_USERNAME.toLowerCase(), 
    password_hash: adminPasswordHash, 
    is_admin: 1, 
    phone: '+256 763 480495', 
    whatsapp_number: '256763480495', 
    has_whatsapp: true,
    created_at: new Date() 
  }
];

let memOrders = [];
let memOrderItems = [];
let memNotifications = [];
let memMessages = [];
let memSupportTickets = [];
let memReturnsRefunds = [];
let memCampaigns = [];
let memPriceChangeRequests = [];
let memPasswordResets = [];

const SYSTEM_WHATSAPP_NUMBER = '256763480495'; // Official EasyMarket Uganda WhatsApp Helpline Line

let ownerCommissionPercentage = 10; // Default 10% platform share / owner payout
let dbLastCheckTime = null;
let dbPingLatency = null;

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
let memNextPriceRequestId = 1;

// Initialize Supabase/PostgreSQL schema with automatic column & schema migration
async function initDatabase() {
  if (!pool) return;

  try {
    const client = await pool.connect();
    try {
      console.log('Testing Supabase / PostgreSQL connection & migrating schema...');
      
      // 1. Create tables if they do not exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'customer',
          is_admin INT DEFAULT 0,
          phone VARCHAR(100),
          whatsapp_number VARCHAR(100),
          has_whatsapp BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          price NUMERIC(15,2) NOT NULL DEFAULT 0,
          image VARCHAR(255),
          image_url TEXT,
          category_id INT,
          location VARCHAR(255) DEFAULT 'Kampala, Uganda',
          condition VARCHAR(100) DEFAULT 'Brand New',
          phone VARCHAR(100),
          seller_phone VARCHAR(100),
          whatsapp_number VARCHAR(100),
          payment_code VARCHAR(100),
          approved INT DEFAULT 1,
          quantity INT DEFAULT 1,
          seller_id INT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS product_images (
          id SERIAL PRIMARY KEY,
          product_id INT,
          image_path VARCHAR(255),
          image_url TEXT,
          is_main BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INT,
          total NUMERIC(15,2) NOT NULL DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Pending',
          address TEXT,
          phone VARCHAR(100),
          payment_reference VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INT,
          product_id INT,
          title VARCHAR(255) NOT NULL,
          price NUMERIC(15,2) NOT NULL,
          quantity INT NOT NULL DEFAULT 1,
          image VARCHAR(255)
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INT,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'system',
          is_read INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          sender_id INT,
          receiver_id INT,
          product_id INT,
          message TEXT NOT NULL,
          is_read INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          user_id INT,
          user_name VARCHAR(255),
          user_email VARCHAR(255),
          subject VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          status VARCHAR(50) DEFAULT 'Open',
          admin_reply TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS returns_refunds (
          id SERIAL PRIMARY KEY,
          order_id INT,
          user_id INT,
          reason TEXT NOT NULL,
          amount NUMERIC(15,2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Pending',
          admin_note TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

        CREATE TABLE IF NOT EXISTS price_change_requests (
          id SERIAL PRIMARY KEY,
          product_id INT NOT NULL,
          seller_id INT NOT NULL,
          requested_by INT NOT NULL,
          current_price NUMERIC(15,2) NOT NULL,
          proposed_price NUMERIC(15,2) NOT NULL,
          reason TEXT,
          status VARCHAR(50) DEFAULT 'Pending',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS password_resets (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          otp_code VARCHAR(10) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 2. Safely ALTER existing Supabase tables so all columns are present (compatible with both pre-existing Supabase tables and our schema)
      const columnAlterStatements = [
        // users table
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'customer'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INT DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // products table
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS image VARCHAR(255)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS condition VARCHAR(100) DEFAULT 'Brand New'",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS location VARCHAR(255) DEFAULT 'Kampala, Uganda'",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS phone VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_phone VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS payment_code VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS approved INT DEFAULT 1",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id INT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // product_images table (Supports both image_url and image_path)
        "ALTER TABLE product_images ADD COLUMN IF NOT EXISTS product_id INT",
        "ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_path VARCHAR(255)",
        "ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_url TEXT",
        "ALTER TABLE product_images ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT FALSE",

        // orders table (Ensures both user_id & buyer_id, total & total_amount, address & delivery_address exist)
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_id INT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(255)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_phone VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS address TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC(15,2) DEFAULT 0",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15,2) DEFAULT 0",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pending'",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // order_items table
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS order_id INT",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id INT",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS title VARCHAR(255)",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price NUMERIC(15,2) DEFAULT 0",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image VARCHAR(255)",
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_url TEXT",

        // notifications table
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INT",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255)",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'system'",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read INT DEFAULT 0",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // messages table
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id INT",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_id INT",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS product_id INT",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS message TEXT",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read INT DEFAULT 0",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // support_tickets table
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_email VARCHAR(255)",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_reply TEXT",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // price_change_requests table
        "ALTER TABLE price_change_requests ADD COLUMN IF NOT EXISTS current_price NUMERIC(15,2) DEFAULT 0",
        "ALTER TABLE price_change_requests ADD COLUMN IF NOT EXISTS proposed_price NUMERIC(15,2) DEFAULT 0",
        "ALTER TABLE price_change_requests ADD COLUMN IF NOT EXISTS reason TEXT",
        "ALTER TABLE price_change_requests ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pending'",
        "ALTER TABLE price_change_requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"
      ];

      for (const sql of columnAlterStatements) {
        try {
          await client.query(sql);
        } catch (err) {
          // Non-blocking if column or type already configured
        }
      }

      // 3. Ensure default categories exist if table is empty
      const catCountRes = await client.query('SELECT COUNT(*) FROM categories');
      if (parseInt(catCountRes.rows[0].count, 10) === 0) {
        for (const cat of memCategories) {
          await client.query('INSERT INTO categories (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [cat.id, cat.name]);
        }
        try {
          await client.query("SELECT setval('categories_id_seq', (SELECT COALESCE(MAX(id), 1) FROM categories))");
        } catch {}
      }

      // 4. Seed admin user if not already present (Dual-setting role='admin' and is_admin=1)
      const userRes = await client.query('SELECT * FROM users WHERE LOWER(email) = $1', [ADMIN_USERNAME.toLowerCase()]);
      if (userRes.rows.length === 0) {
        try {
          await client.query(`
            INSERT INTO users (name, email, password_hash, role, is_admin, phone, whatsapp_number, has_whatsapp)
            VALUES ($1, $2, $3, 'admin', 1, '+256 763 480495', '256763480495', TRUE)
          `, ['EasyMarket Admin', ADMIN_USERNAME.toLowerCase(), adminPasswordHash]);
        } catch (err) {
          console.warn('Admin user insert fallback:', err.message);
          await client.query(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES ($1, $2, $3, 'admin')
          `, ['EasyMarket Admin', ADMIN_USERNAME.toLowerCase(), adminPasswordHash]);
        }
      }

      isConnectedToPostgres = true;
      lastDbError = null;
      lastDbErrorCode = null;
      lastDbSuccessTime = new Date();
      console.log('✅ PostgreSQL / Supabase Database Connected & Synchronized Successfully!');
    } finally {
      client.release();
    }
  } catch (err) {
    lastDbError = err.message;
    lastDbErrorCode = err.code || null;
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
        price: isNaN(parseFloat(r.price)) ? 0 : parseFloat(r.price),
        quantity: isNaN(parseInt(r.quantity, 10)) ? 1 : parseInt(r.quantity, 10),
        approved: (r.approved === true || r.approved === 1 || r.approved === '1' || r.approved == null || r.approved === 'true') ? 1 : 0
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
        price: isNaN(parseFloat(p.price)) ? 0 : parseFloat(p.price),
        quantity: isNaN(parseInt(p.quantity, 10)) ? 1 : parseInt(p.quantity, 10),
        approved: (p.approved === true || p.approved === 1 || p.approved === '1' || p.approved == null || p.approved === 'true') ? 1 : 0,
        category_name: cat ? cat.name : 'General'
      };
    });
    if (filterFn) {
      list = list.filter(filterFn);
    }
    return list;
  },

  async getAllProducts() {
    return this.getProducts();
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
        price: isNaN(parseFloat(row.price)) ? 0 : parseFloat(row.price),
        quantity: isNaN(parseInt(row.quantity, 10)) ? 1 : parseInt(row.quantity, 10),
        approved: (row.approved === true || row.approved === 1 || row.approved === '1' || row.approved == null || row.approved === 'true') ? 1 : 0
      };
    }
    const p = memProducts.find(item => item.id === id);
    if (!p) return null;
    const cat = memCategories.find(c => c.id === p.category_id);
    return {
      ...p,
      price: isNaN(parseFloat(p.price)) ? 0 : parseFloat(p.price),
      quantity: isNaN(parseInt(p.quantity, 10)) ? 1 : parseInt(p.quantity, 10),
      approved: (p.approved === true || p.approved === 1 || p.approved === '1' || p.approved == null || p.approved === 'true') ? 1 : 0,
      category_name: cat ? cat.name : 'General'
    };
  },

  async getProductImages(productId) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT id, product_id, COALESCE(image_url, image_path) AS image_path, COALESCE(image_url, image_path) AS image_url, is_main FROM product_images WHERE product_id = $1 ORDER BY is_main DESC, id ASC', [productId]);
      if (res.rows.length > 0) {
        return res.rows;
      }
      const prodRes = await pool.query('SELECT COALESCE(image_url, image) AS image FROM products WHERE id = $1', [productId]);
      if (prodRes.rows.length > 0 && prodRes.rows[0].image) {
        return [{ id: 0, product_id: productId, image_path: prodRes.rows[0].image, image_url: prodRes.rows[0].image, is_main: 1 }];
      }
      return [];
    }
    const memList = memProductImages.filter(img => img.product_id === productId);
    if (memList.length > 0) return memList;
    const p = memProducts.find(item => item.id === productId);
    if (p && (p.image || p.image_url)) {
      const img = p.image_url || p.image;
      return [{ id: 0, product_id: productId, image_path: img, image_url: img, is_main: 1 }];
    }
    return [];
  },

  async getSimilarProducts(categoryId, currentId, limit = 4) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT p.*, COALESCE(p.image_url, p.image) as image, COALESCE(p.image_url, p.image) as image_url, c.name as category_name
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.category_id = $1 AND p.id != $2 AND (p.approved = 1 OR p.approved IS NULL OR p.approved = true) AND p.quantity > 0
        ORDER BY p.id DESC LIMIT $3
      `, [categoryId, currentId, limit]);
      return res.rows.map(r => ({ ...r, price: parseFloat(r.price) }));
    }
    return memProducts
      .filter(p => p.category_id === categoryId && p.id !== currentId && (p.approved === 1 || p.approved == null) && p.quantity > 0)
      .slice(0, limit);
  },

  async createProduct({ title, description, price, category_id, phone, whatsapp_number, location, payment_code, quantity, images, seller_id, condition = 'Brand New' }) {
    const mainImage = (images && images.length > 0) ? images[0] : 'phone-front.svg';
    const wa = sanitizeWhatsAppNumber(whatsapp_number || phone);
    const parsedPrice = isNaN(parseFloat(price)) ? 0 : parseFloat(price);
    const parsedQty = isNaN(parseInt(quantity, 10)) ? 1 : Math.max(1, parseInt(quantity, 10));
    let parsedCatId = parseInt(category_id, 10) || 1;

    if (isConnectedToPostgres && pool) {
      // 1. Sanitize category ID against PostgreSQL categories
      try {
        const catRes = await pool.query('SELECT id FROM categories WHERE id = $1', [parsedCatId]);
        if (catRes.rows.length === 0) {
          const firstCat = await pool.query('SELECT id FROM categories ORDER BY id ASC LIMIT 1');
          if (firstCat.rows.length > 0) {
            parsedCatId = firstCat.rows[0].id;
          }
        }
      } catch (err) {
        console.warn('Error checking category in PG:', err.message);
      }

      // 2. Sanitize seller_id to avoid FK constraint failures
      let validSellerId = null;
      if (seller_id) {
        try {
          const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [seller_id]);
          if (userRes.rows.length > 0) {
            validSellerId = seller_id;
          }
        } catch (err) {
          console.warn('Error checking seller in PG:', err.message);
        }
      }

      const res = await pool.query(`
        INSERT INTO products (title, description, price, category_id, phone, seller_phone, whatsapp_number, location, condition, image, image_url, payment_code, quantity, approved, seller_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, $14)
        RETURNING id
      `, [title, description, parsedPrice, parsedCatId, phone, phone, wa, location || 'Kampala, Uganda', condition, mainImage, mainImage, payment_code, parsedQty, validSellerId]);
      
      const newProdId = res.rows[0].id;
      if (images && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          await pool.query(`
            INSERT INTO product_images (product_id, image_path, image_url, is_main)
            VALUES ($1, $2, $3, $4)
          `, [newProdId, images[i], images[i], i === 0]);
        }
      }
      return newProdId;
    }

    const newProdId = memNextProdId++;
    memProducts.unshift({
      id: newProdId,
      title,
      description,
      price: parsedPrice,
      category_id: parsedCatId,
      phone,
      seller_phone: phone,
      whatsapp_number: wa,
      has_whatsapp: !!wa,
      location: location || 'Kampala, Uganda',
      condition,
      image: mainImage,
      image_url: mainImage,
      payment_code,
      quantity: parsedQty,
      approved: 1,
      seller_id: seller_id || 2,
      created_at: new Date()
    });

    if (images && images.length > 0) {
      images.forEach((file, index) => {
        memProductImages.push({
          id: memNextImgId++,
          product_id: newProdId,
          image_path: file,
          image_url: file,
          is_main: index === 0 ? 1 : 0
        });
      });
    }

    return newProdId;
  },

  async getAvailableProducts() {
    return this.getProducts(p => p.quantity > 0 && (p.approved === 1 || p.approved === true));
  },

  async getSoldProducts() {
    return this.getProducts(p => p.quantity <= 0);
  },

  async getProductsBySeller(sellerId) {
    const sId = parseInt(sellerId, 10);
    if (!sId) return [];
    return this.getProducts(p => p.seller_id === sId);
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

  // Seller Price Update (Only publisher/seller can change their own product's price)
  async updateProductPriceBySeller(productId, sellerId, newPrice, newQuantity = null) {
    const pId = parseInt(productId, 10);
    const sId = parseInt(sellerId, 10);
    const parsedPrice = parseFloat(newPrice);

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return { success: false, error: 'Price must be a valid positive number.' };
    }

    const prod = await this.getProductById(pId);
    if (!prod) {
      return { success: false, error: 'Product not found.' };
    }

    // Security check: Must be the owner/seller who published it
    if (prod.seller_id && prod.seller_id !== sId) {
      return { success: false, error: 'Permission Denied: You can only edit prices of products that you published.' };
    }

    if (isConnectedToPostgres && pool) {
      let q = 'UPDATE products SET price = $1';
      const params = [parsedPrice];
      if (newQuantity !== null && !isNaN(parseInt(newQuantity, 10))) {
        params.push(Math.max(0, parseInt(newQuantity, 10)));
        q += `, quantity = $${params.length}`;
      }
      params.push(pId);
      q += ` WHERE id = $${params.length}`;
      await pool.query(q, params);
    } else {
      const mProd = memProducts.find(p => p.id === pId);
      if (mProd) {
        mProd.price = parsedPrice;
        if (newQuantity !== null && !isNaN(parseInt(newQuantity, 10))) {
          mProd.quantity = Math.max(0, parseInt(newQuantity, 10));
        }
      }
    }

    // Auto-resolve any pending price change requests for this product
    await this.cancelPendingPriceRequestsForProduct(pId, 'Seller updated price directly');

    return { success: true, newPrice: parsedPrice };
  },

  // Admin Product Update with Seller Price Protection:
  // Admin CANNOT change price without owner accepting, so if price changed and product belongs to another seller, create a proposal!
  async adminUpdateProductOrProposePrice(productId, adminUserId, { title, price, quantity, approved, reason = '' }) {
    const pId = parseInt(productId, 10);
    const prod = await this.getProductById(pId);
    if (!prod) {
      return { success: false, error: 'Product not found.' };
    }

    const parsedPrice = price !== undefined ? parseFloat(price) : prod.price;
    const parsedQty = quantity !== undefined ? Math.max(0, parseInt(quantity, 10)) : prod.quantity;
    const parsedApproved = approved !== undefined ? parseInt(approved, 10) : prod.approved;

    let priceProposalCreated = false;
    let priceProposalId = null;

    // Check if price is being changed on a product published by someone else
    const isPriceChanged = !isNaN(parsedPrice) && Math.round(parsedPrice) !== Math.round(prod.price);
    const isOwnedByDifferentSeller = prod.seller_id && prod.seller_id !== adminUserId && prod.seller_id !== 1;

    if (isPriceChanged && isOwnedByDifferentSeller) {
      // Create price change request for the seller to review & accept
      const reqRes = await this.createPriceChangeRequest({
        productId: pId,
        sellerId: prod.seller_id,
        requestedBy: adminUserId || 1,
        currentPrice: prod.price,
        proposedPrice: parsedPrice,
        reason: reason || 'Market price alignment recommended by Admin'
      });
      priceProposalCreated = true;
      priceProposalId = reqRes.id;

      // Update non-price fields directly
      await this.quickUpdateProduct(pId, {
        title: title || prod.title,
        price: prod.price, // Keep original price until seller accepts
        quantity: parsedQty,
        approved: parsedApproved
      });

      return {
        success: true,
        priceProposalCreated: true,
        proposedPrice: parsedPrice,
        currentPrice: prod.price,
        message: `Price proposal of UGX ${Number(parsedPrice).toLocaleString()} submitted to Seller #${prod.seller_id}. Per marketplace policy, the product owner must accept before the price updates.`
      };
    } else {
      // Admin published it or price wasn't changed: direct update
      await this.quickUpdateProduct(pId, {
        title: title || prod.title,
        price: parsedPrice,
        quantity: parsedQty,
        approved: parsedApproved
      });

      return {
        success: true,
        priceProposalCreated: false,
        message: 'Product details updated successfully.'
      };
    }
  },

  // Price Change Proposal Engine
  async createPriceChangeRequest({ productId, sellerId, requestedBy, currentPrice, proposedPrice, reason }) {
    const prod = await this.getProductById(productId);
    const prodTitle = prod ? prod.title : `Product #${productId}`;

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        INSERT INTO price_change_requests (product_id, seller_id, requested_by, current_price, proposed_price, reason, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'Pending')
        RETURNING *
      `, [productId, sellerId, requestedBy, currentPrice, proposedPrice, reason]);
      
      const reqObj = res.rows[0];

      // Notify the product owner
      await this.createNotification({
        userId: sellerId,
        title: '🏷️ Price Change Proposal from Admin',
        message: `Admin proposed changing the price of your product "${prodTitle}" from UGX ${Number(currentPrice).toLocaleString()} to UGX ${Number(proposedPrice).toLocaleString()}. Reason: ${reason || 'Market alignment'}. Please review and Accept or Decline in My Listings.`,
        type: 'price_proposal'
      });

      return reqObj;
    }

    const newReq = {
      id: memNextPriceRequestId++,
      product_id: productId,
      seller_id: sellerId,
      requested_by: requestedBy,
      current_price: currentPrice,
      proposed_price: proposedPrice,
      reason: reason || 'Market alignment',
      status: 'Pending',
      created_at: new Date(),
      resolved_at: null
    };
    memPriceChangeRequests.unshift(newReq);

    // Notify seller
    await this.createNotification({
      userId: sellerId,
      title: '🏷️ Price Change Proposal from Admin',
      message: `Admin proposed changing the price of your product "${prodTitle}" from UGX ${Number(currentPrice).toLocaleString()} to UGX ${Number(proposedPrice).toLocaleString()}. Reason: ${reason || 'Market alignment'}. Please review and Accept or Decline in My Listings.`,
      type: 'price_proposal'
    });

    return newReq;
  },

  async getPendingPriceChangeRequestsForSeller(sellerId) {
    const sId = parseInt(sellerId, 10);
    if (!sId) return [];

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT pcr.*, p.title as product_title, p.image as product_image, p.price as current_live_price, p.quantity as product_quantity
        FROM price_change_requests pcr
        LEFT JOIN products p ON pcr.product_id = p.id
        WHERE pcr.seller_id = $1 AND pcr.status = 'Pending'
        ORDER BY pcr.id DESC
      `, [sId]);
      return res.rows.map(r => ({
        ...r,
        current_price: parseFloat(r.current_price),
        proposed_price: parseFloat(r.proposed_price)
      }));
    }

    return memPriceChangeRequests
      .filter(r => r.seller_id === sId && r.status === 'Pending')
      .map(r => {
        const p = memProducts.find(prod => prod.id === r.product_id);
        return {
          ...r,
          product_title: p ? p.title : `Product #${r.product_id}`,
          product_image: p ? p.image : 'phone-front.svg',
          current_live_price: p ? p.price : r.current_price,
          product_quantity: p ? p.quantity : 1
        };
      });
  },

  async getPendingPriceChangeRequestsForProduct(productId) {
    const pId = parseInt(productId, 10);
    if (!pId) return null;

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT * FROM price_change_requests WHERE product_id = $1 AND status = 'Pending' ORDER BY id DESC LIMIT 1
      `, [pId]);
      return res.rows[0] || null;
    }

    return memPriceChangeRequests.find(r => r.product_id === pId && r.status === 'Pending') || null;
  },

  async getAllPriceChangeRequests() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT pcr.*, p.title as product_title, p.image as product_image, u.name as seller_name, u.email as seller_email, u.phone as seller_phone
        FROM price_change_requests pcr
        LEFT JOIN products p ON pcr.product_id = p.id
        LEFT JOIN users u ON pcr.seller_id = u.id
        ORDER BY pcr.id DESC
      `);
      return res.rows.map(r => ({
        ...r,
        current_price: parseFloat(r.current_price),
        proposed_price: parseFloat(r.proposed_price)
      }));
    }

    return memPriceChangeRequests.map(r => {
      const p = memProducts.find(prod => prod.id === r.product_id);
      const u = memUsers.find(user => user.id === r.seller_id);
      return {
        ...r,
        product_title: p ? p.title : `Product #${r.product_id}`,
        product_image: p ? p.image : 'phone-front.svg',
        seller_name: u ? u.name : 'Seller #' + r.seller_id,
        seller_email: u ? u.email : '',
        seller_phone: u ? u.phone : ''
      };
    });
  },

  async resolvePriceChangeRequest(requestId, decision, sellerUserId) {
    const reqId = parseInt(requestId, 10);
    const sId = parseInt(sellerUserId, 10);
    const validDecision = decision === 'Accepted' ? 'Accepted' : 'Rejected';

    let request = null;
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM price_change_requests WHERE id = $1', [reqId]);
      request = res.rows[0] || null;
    } else {
      request = memPriceChangeRequests.find(r => r.id === reqId) || null;
    }

    if (!request) {
      return { success: false, error: 'Price proposal request not found.' };
    }

    if (request.status !== 'Pending') {
      return { success: false, error: `This price request has already been ${request.status.toLowerCase()}.` };
    }

    // Security check: Only product owner / seller can accept or reject
    if (request.seller_id && request.seller_id !== sId) {
      return { success: false, error: 'Access Denied: Only the owner of this product can accept or decline price changes.' };
    }

    const prod = await this.getProductById(request.product_id);
    const prodTitle = prod ? prod.title : `Product #${request.product_id}`;
    const newPrice = parseFloat(request.proposed_price);

    if (validDecision === 'Accepted') {
      // 1. Update live product price
      if (isConnectedToPostgres && pool) {
        await pool.query('UPDATE products SET price = $1 WHERE id = $2', [newPrice, request.product_id]);
        await pool.query('UPDATE price_change_requests SET status = $1, resolved_at = NOW() WHERE id = $2', ['Accepted', reqId]);
      } else {
        if (prod) prod.price = newPrice;
        const mProd = memProducts.find(p => p.id === request.product_id);
        if (mProd) mProd.price = newPrice;
        request.status = 'Accepted';
        request.resolved_at = new Date();
      }

      // 2. Notifications
      await this.createNotification({
        userId: sId,
        title: '✅ Price Adjustment Confirmed',
        message: `You accepted the proposed price for "${prodTitle}". The live marketplace price is now UGX ${Number(newPrice).toLocaleString()}.`,
        type: 'price_update'
      });

      // Notify Admin
      const adminUsers = await this.getAdminUsers();
      for (const admin of adminUsers) {
        await this.createNotification({
          userId: admin.id,
          title: '🎉 Seller Accepted Price Change',
          message: `Seller has accepted the price proposal for "${prodTitle}". Live price updated to UGX ${Number(newPrice).toLocaleString()}.`,
          type: 'price_approved'
        });
      }

      return {
        success: true,
        decision: 'Accepted',
        newPrice,
        message: `Price successfully updated to UGX ${Number(newPrice).toLocaleString()}!`
      };
    } else {
      // Rejected
      if (isConnectedToPostgres && pool) {
        await pool.query('UPDATE price_change_requests SET status = $1, resolved_at = NOW() WHERE id = $2', ['Rejected', reqId]);
      } else {
        request.status = 'Rejected';
        request.resolved_at = new Date();
      }

      await this.createNotification({
        userId: sId,
        title: '❌ Price Proposal Declined',
        message: `You declined the proposed price for "${prodTitle}". The price remains UGX ${Number(request.current_price).toLocaleString()}.`,
        type: 'price_rejected'
      });

      const adminUsers = await this.getAdminUsers();
      for (const admin of adminUsers) {
        await this.createNotification({
          userId: admin.id,
          title: '⚠️ Seller Declined Price Proposal',
          message: `Seller declined the price proposal of UGX ${Number(request.proposed_price).toLocaleString()} for "${prodTitle}". Price remains UGX ${Number(request.current_price).toLocaleString()}.`,
          type: 'price_rejected'
        });
      }

      return {
        success: true,
        decision: 'Rejected',
        message: 'Price proposal was declined. Product price remains unchanged.'
      };
    }
  },

  async cancelPendingPriceRequestsForProduct(productId, reason = 'Cancelled') {
    if (isConnectedToPostgres && pool) {
      await pool.query("UPDATE price_change_requests SET status = 'Cancelled', resolved_at = NOW() WHERE product_id = $1 AND status = 'Pending'", [productId]);
    } else {
      memPriceChangeRequests.forEach(r => {
        if (r.product_id === productId && r.status === 'Pending') {
          r.status = 'Cancelled';
          r.resolved_at = new Date();
        }
      });
    }
  },

  async getAdminUsers() {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query("SELECT * FROM users WHERE is_admin = 1 OR role = 'admin' OR LOWER(email) = $1", [ADMIN_USERNAME.toLowerCase()]);
      return res.rows;
    }
    return memUsers.filter(u => u.is_admin === 1 || u.role === 'admin' || u.email.toLowerCase() === ADMIN_USERNAME.toLowerCase());
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
    const pId = parseInt(productId, 10);
    if (!pId) return;

    if (isConnectedToPostgres && pool) {
      try {
        await pool.query('DELETE FROM price_change_requests WHERE product_id = $1', [pId]);
      } catch {}
      await pool.query('DELETE FROM product_images WHERE product_id = $1', [pId]);
      await pool.query('DELETE FROM products WHERE id = $1', [pId]);
      return;
    }
    memPriceChangeRequests = memPriceChangeRequests.filter(r => r.product_id !== pId);
    memProducts = memProducts.filter(p => p.id !== pId);
    memProductImages = memProductImages.filter(img => img.product_id !== pId);
  },

  async findUserByEmailOrUsername(emailOrUsername) {
    const queryStr = (emailOrUsername || '').trim().toLowerCase();
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [queryStr]);
      if (res.rows.length === 0) return null;
      const u = res.rows[0];
      return {
        ...u,
        is_admin: (u.is_admin === 1 || u.role === 'admin' || u.email.toLowerCase() === ADMIN_USERNAME.toLowerCase()) ? 1 : 0
      };
    }
    const u = memUsers.find(usr => usr.email.toLowerCase() === queryStr);
    if (!u) return null;
    return {
      ...u,
      is_admin: (u.is_admin === 1 || u.role === 'admin' || u.email.toLowerCase() === ADMIN_USERNAME.toLowerCase()) ? 1 : 0
    };
  },

  async findUserById(id) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      const u = res.rows[0];
      return {
        ...u,
        is_admin: (u.is_admin === 1 || u.role === 'admin' || u.email.toLowerCase() === ADMIN_USERNAME.toLowerCase()) ? 1 : 0
      };
    }
    const u = memUsers.find(usr => usr.id === id);
    if (!u) return null;
    return {
      ...u,
      is_admin: (u.is_admin === 1 || u.role === 'admin' || u.email.toLowerCase() === ADMIN_USERNAME.toLowerCase()) ? 1 : 0
    };
  },

  async createUser(name, email, passwordHash, isAdmin = 0, phone = '', whatsappNumber = '') {
    const wa = sanitizeWhatsAppNumber(whatsappNumber || phone);
    const hasWa = !!wa;
    const roleStr = isAdmin ? 'admin' : 'customer';

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, is_admin, phone, whatsapp_number, has_whatsapp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [name, email.toLowerCase(), passwordHash, roleStr, isAdmin, phone, wa, hasWa]
      );
      const user = res.rows[0];
      user.is_admin = isAdmin;
      // Create initial welcome & 10-sentence anti-deception policy notification
      await this.createNotification({
        userId: user.id,
        title: '🛡️ Mandatory Anti-Deception & Authenticity Policy',
        message: REGISTRATION_INTEGRITY_MESSAGE,
        type: 'integrity_warning'
      });
      return user;
    }

    const newUser = {
      id: memNextUserId++,
      name,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      role: roleStr,
      is_admin: isAdmin,
      phone,
      whatsapp_number: wa,
      has_whatsapp: hasWa,
      created_at: new Date()
    };
    memUsers.push(newUser);

    // Initial welcome & 10-sentence anti-deception policy notification
    this.createNotification({
      userId: newUser.id,
      title: '🛡️ Mandatory Anti-Deception & Authenticity Policy',
      message: REGISTRATION_INTEGRITY_MESSAGE,
      type: 'integrity_warning'
    });

    return newUser;
  },

  async syncDatabase() {
    await initDatabase();
    if (!isConnectedToPostgres || !pool) {
      return {
        success: false,
        isConnected: false,
        message: 'Supabase PostgreSQL connection is inactive or DATABASE_URL is not set in environment settings.'
      };
    }

    try {
      const client = await pool.connect();
      try {
        // Sync any in-memory products into PostgreSQL if any exist
        for (const p of memProducts) {
          const checkRes = await client.query('SELECT id FROM products WHERE title = $1', [p.title]);
          if (checkRes.rows.length === 0) {
            const insRes = await client.query(`
              INSERT INTO products (title, description, price, category_id, phone, seller_phone, whatsapp_number, location, condition, image, image_url, payment_code, quantity, approved)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
              RETURNING id
            `, [p.title, p.description, p.price, p.category_id, p.phone, p.seller_phone || p.phone, p.whatsapp_number, p.location || 'Kampala, Uganda', p.condition || 'Brand New', p.image, p.image_url || p.image, p.payment_code, p.quantity || 1]);
            
            const newId = insRes.rows[0].id;
            const prodImgs = memProductImages.filter(img => img.product_id === p.id);
            for (let i = 0; i < prodImgs.length; i++) {
              await client.query(`
                INSERT INTO product_images (product_id, image_path, image_url, is_main)
                VALUES ($1, $2, $3, $4)
              `, [newId, prodImgs[i].image_path || prodImgs[i].image_url, prodImgs[i].image_url || prodImgs[i].image_path, i === 0]);
            }
          }
        }

        const [prodCount, imgCount, userCount, orderCount, catCount] = await Promise.all([
          client.query('SELECT COUNT(*) FROM products'),
          client.query('SELECT COUNT(*) FROM product_images'),
          client.query('SELECT COUNT(*) FROM users'),
          client.query('SELECT COUNT(*) FROM orders'),
          client.query('SELECT COUNT(*) FROM categories')
        ]);

        return {
          success: true,
          isConnected: true,
          counts: {
            products: parseInt(prodCount.rows[0].count, 10),
            product_images: parseInt(imgCount.rows[0].count, 10),
            users: parseInt(userCount.rows[0].count, 10),
            orders: parseInt(orderCount.rows[0].count, 10),
            categories: parseInt(catCount.rows[0].count, 10)
          }
        };
      } finally {
        client.release();
      }
    } catch (err) {
      lastDbError = err.message;
      lastDbErrorCode = err.code || null;
      return {
        success: false,
        isConnected: false,
        error: err.message
      };
    }
  },

  async getSupabaseDiagnostics() {
    let latencyMs = null;
    let counts = {
      products: memProducts.length,
      product_images: memProductImages.length,
      users: memUsers.length,
      orders: memOrders.length,
      categories: memCategories.length
    };
    let cloudCounts = null;
    let sampleRows = [];
    let serverTime = null;
    let currentDatabase = 'postgres';
    let currentHost = lastDbHost || (process.env.PGHOST || 'db.ijizfozhorgaidgjonws.supabase.co');

    if (isConnectedToPostgres && pool) {
      try {
        const start = Date.now();
        const pingRes = await pool.query('SELECT NOW() as server_time, current_database() as db_name');
        latencyMs = Date.now() - start;
        serverTime = pingRes.rows[0]?.server_time || new Date();
        currentDatabase = pingRes.rows[0]?.db_name || 'postgres';

        const [prodCount, imgCount, userCount, orderCount, catCount] = await Promise.all([
          pool.query('SELECT COUNT(*) FROM products'),
          pool.query('SELECT COUNT(*) FROM product_images'),
          pool.query('SELECT COUNT(*) FROM users'),
          pool.query('SELECT COUNT(*) FROM orders'),
          pool.query('SELECT COUNT(*) FROM categories')
        ]);

        cloudCounts = {
          products: parseInt(prodCount.rows[0].count, 10),
          product_images: parseInt(imgCount.rows[0].count, 10),
          users: parseInt(userCount.rows[0].count, 10),
          orders: parseInt(orderCount.rows[0].count, 10),
          categories: parseInt(catCount.rows[0].count, 10)
        };

        const prodSample = await pool.query(`
          SELECT p.id, p.title, p.price, p.quantity, p.condition, p.location, p.phone, p.whatsapp_number, p.payment_code, p.approved, p.image, p.created_at, c.name as category_name
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          ORDER BY p.id DESC
          LIMIT 15
        `);
        sampleRows = prodSample.rows.map(r => ({ ...r, price: parseFloat(r.price), is_in_supabase: true }));
      } catch (err) {
        lastDbError = err.message;
        lastDbErrorCode = err.code || null;
      }
    }

    // Mask sensitive connection string for display
    let maskedUrl = 'postgresql://postgres:••••••••@db.ijizfozhorgaidgjonws.supabase.co:5432/postgres';
    if (rawConnectionString) {
      maskedUrl = rawConnectionString.replace(/:([^:@]+)@/, ':••••••••@');
    }

    return {
      isConnected: isConnectedToPostgres,
      host: currentHost,
      projectRef: lastDbProjectRef || 'ijizfozhorgaidgjonws',
      database: currentDatabase,
      maskedUrl,
      rawConnectionString: rawConnectionString || '',
      lastError: lastDbError,
      lastErrorCode: lastDbErrorCode,
      lastSuccessTime: lastDbSuccessTime,
      latencyMs,
      serverTime,
      counts: cloudCounts || counts,
      isFallback: !isConnectedToPostgres,
      sampleRows
    };
  },

  async getSupabaseRawProducts(limit = 50) {
    if (isConnectedToPostgres && pool) {
      try {
        const res = await pool.query(`
          SELECT p.id, p.title, p.description, p.price, p.quantity, p.condition, p.location, p.phone, p.seller_phone, p.whatsapp_number, p.payment_code, p.approved, p.image, p.created_at, c.name as category_name
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          ORDER BY p.id DESC
          LIMIT $1
        `, [limit]);
        return res.rows.map(r => ({ ...r, price: parseFloat(r.price), is_in_supabase: true }));
      } catch (err) {
        console.warn('Error fetching Supabase raw products:', err.message);
      }
    }
    return memProducts.map(p => {
      const cat = memCategories.find(c => c.id === p.category_id);
      return { ...p, category_name: cat ? cat.name : 'General', is_in_supabase: false };
    }).slice(0, limit);
  },

  async reconnectDatabase(targetInput) {
    let connStr = '';
    if (typeof targetInput === 'string') {
      connStr = targetInput.trim();
    } else if (targetInput && targetInput.connectionString) {
      connStr = targetInput.connectionString.trim();
    } else if (targetInput && targetInput.password) {
      const pass = targetInput.password.trim();
      const ref = (targetInput.projectRef || lastDbProjectRef || 'ijizfozhorgaidgjonws').trim();
      const host = targetInput.host || (targetInput.usePooler ? `aws-0-eu-central-1.pooler.supabase.com` : `db.${ref}.supabase.co`);
      const port = targetInput.port || (targetInput.usePooler ? 6543 : 5432);
      const user = targetInput.usePooler ? `postgres.${ref}` : 'postgres';
      const dbName = targetInput.database || 'postgres';
      connStr = `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${dbName}`;
    }

    if (!connStr) {
      return {
        success: false,
        isConnected: false,
        error: 'No database connection string or password provided.'
      };
    }

    const testConfig = parsePgConfig(connStr);
    if (!testConfig) {
      return {
        success: false,
        isConnected: false,
        error: 'Failed to parse database connection URI.'
      };
    }

    const testPool = new Pool(testConfig);
    try {
      const client = await testPool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }

      // If test succeeded, replace the global pool
      if (pool) {
        try { pool.end(); } catch {}
      }
      pool = testPool;
      rawConnectionString = connStr;
      saveConnectionStringToDisk(connStr);
      isConnectedToPostgres = true;
      lastDbError = null;
      lastDbErrorCode = null;
      lastDbSuccessTime = new Date();

      // Run schema migrations and sync any in-memory products
      await initDatabase();
      const syncRes = await this.syncDatabase();

      return {
        success: true,
        isConnected: true,
        message: 'Successfully connected to Supabase PostgreSQL database! All tables and products are synchronized.',
        counts: syncRes.counts || null
      };
    } catch (err) {
      try { testPool.end(); } catch {}
      lastDbError = err.message;
      lastDbErrorCode = err.code || null;
      
      let helpfulAdvice = '';
      if (err.code === 'ECONNREFUSED' || (err.message && err.message.includes('ECONNREFUSED'))) {
        helpfulAdvice = 'Direct Supabase host (db.ijizfozhorgaidgjonws.supabase.co) only supports IPv6. To connect from cloud servers, use the Supabase Connection Pooler: In your Supabase Dashboard, click the green "Connect" button at the top header, select "Transaction pooler" or "Session pooler" (e.g. aws-0-[region].pooler.supabase.com:6543) and copy the URI.';
      } else if (err.code === '28P01' || (err.message && err.message.includes('password authentication failed'))) {
        helpfulAdvice = 'Password Authentication Failed (Code: 28P01). The database password does not match your Supabase project. Go to Supabase Dashboard -> Project Settings -> Database -> Database password, reset/set your password, and enter the new password.';
      } else if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        helpfulAdvice = 'Network host unreachable or timed out. Please check your Supabase project status or try using the Supabase Connection Pooler URI (Session Mode or Transaction Mode).';
      }

      return {
        success: false,
        isConnected: isConnectedToPostgres,
        error: err.message,
        code: err.code || null,
        helpfulAdvice
      };
    }
  },

  // Notification Methods
  async createNotification({ userId, title, message, type = 'system' }) {
    if (isConnectedToPostgres && pool) {
      try {
        await pool.query(
          'INSERT INTO notifications (user_id, title, message, type, is_read) VALUES ($1, $2, $3, $4, FALSE)',
          [userId, title, message, type]
        );
      } catch (err) {
        console.warn('Could not insert notification into Postgres:', err.message);
      }
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
      await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [notificationId, userId]);
      return;
    }
    const notif = memNotifications.find(n => n.id === notificationId && n.user_id === userId);
    if (notif) notif.is_read = 1;
  },

  // Messaging System
  async sendMessage({ senderId, receiverId, productId, message }) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, product_id, message, is_read) VALUES ($1, $2, $3, $4, FALSE) RETURNING *',
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

  // Retrieve all customer message threads for Admin follow-up with full profile details
  async getAllCustomerMessagesForAdmin() {
    let allMsgs = [];
    if (isConnectedToPostgres && pool) {
      const res = await pool.query(`
        SELECT m.*, 
               s.name as sender_name, s.email as sender_email, s.phone as sender_phone, s.whatsapp_number as sender_whatsapp, s.role as sender_role, s.is_admin as sender_is_admin,
               r.name as receiver_name, r.email as receiver_email, r.phone as receiver_phone, r.whatsapp_number as receiver_whatsapp, r.role as receiver_role, r.is_admin as receiver_is_admin,
               p.title as product_title, p.price as product_price, p.image as product_image
        FROM messages m
        LEFT JOIN users s ON m.sender_id = s.id
        LEFT JOIN users r ON m.receiver_id = r.id
        LEFT JOIN products p ON m.product_id = p.id
        ORDER BY m.created_at ASC
      `);
      allMsgs = res.rows;
    } else {
      allMsgs = memMessages.map(m => {
        const sender = memUsers.find(u => u.id === m.sender_id);
        const receiver = memUsers.find(u => u.id === m.receiver_id);
        const prod = m.product_id ? memProducts.find(p => p.id === m.product_id) : null;
        return {
          ...m,
          sender_name: sender ? sender.name : 'Customer',
          sender_email: sender ? sender.email : '',
          sender_phone: sender ? (sender.phone || '') : '',
          sender_whatsapp: sender ? (sender.whatsapp_number || '') : '',
          sender_role: sender ? (sender.role || 'customer') : 'customer',
          sender_is_admin: sender ? (sender.is_admin || 0) : 0,
          receiver_name: receiver ? receiver.name : 'User',
          receiver_email: receiver ? receiver.email : '',
          receiver_phone: receiver ? (receiver.phone || '') : '',
          receiver_whatsapp: receiver ? (receiver.whatsapp_number || '') : '',
          receiver_role: receiver ? (receiver.role || 'customer') : 'customer',
          receiver_is_admin: receiver ? (receiver.is_admin || 0) : 0,
          product_title: prod ? prod.title : null,
          product_price: prod ? prod.price : null,
          product_image: prod ? prod.image : null
        };
      });
    }

    // Group threads by customer (non-admin or counterparty)
    const customerThreads = {};
    for (const msg of allMsgs) {
      // Determine which user is the customer
      const isSenderAdmin = msg.sender_is_admin === 1 || (msg.sender_email && msg.sender_email.toLowerCase().includes('admin'));
      const customerUserId = isSenderAdmin ? msg.receiver_id : msg.sender_id;
      const customerName = isSenderAdmin ? msg.receiver_name : msg.sender_name;
      const customerEmail = isSenderAdmin ? msg.receiver_email : msg.sender_email;
      const customerPhone = isSenderAdmin ? msg.receiver_phone : msg.sender_phone;
      const customerWhatsApp = isSenderAdmin ? msg.receiver_whatsapp : msg.sender_whatsapp;

      if (!customerThreads[customerUserId]) {
        customerThreads[customerUserId] = {
          customerId: customerUserId,
          customerName: customerName || `Customer #${customerUserId}`,
          customerEmail: customerEmail || 'Not specified',
          customerPhone: customerPhone || 'Not specified',
          customerWhatsApp: customerWhatsApp || customerPhone || '',
          productTitle: msg.product_title,
          productPrice: msg.product_price,
          productImage: msg.product_image,
          productId: msg.product_id,
          lastMessage: msg.message,
          lastTime: msg.created_at,
          unreadCount: 0,
          messages: []
        };
      }

      customerThreads[customerUserId].messages.push(msg);
      customerThreads[customerUserId].lastMessage = msg.message;
      customerThreads[customerUserId].lastTime = msg.created_at;
      if (!isSenderAdmin && !msg.is_read) {
        customerThreads[customerUserId].unreadCount++;
      }
    }

    return Object.values(customerThreads).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  },

  // Password Recovery with One-Time Password (OTP)
  async createPasswordResetOtp(email) {
    const cleanEmail = email.trim().toLowerCase();
    // 6-digit numeric OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Valid for 15 minutes

    if (isConnectedToPostgres && pool) {
      // Invalidate previous unused OTPs for this email
      await pool.query('UPDATE password_resets SET used = 1 WHERE LOWER(email) = $1', [cleanEmail]);
      await pool.query(
        'INSERT INTO password_resets (email, otp_code, expires_at, used) VALUES ($1, $2, $3, 0)',
        [cleanEmail, otpCode, expiresAt]
      );
    } else {
      memPasswordResets.forEach(r => {
        if (r.email.toLowerCase() === cleanEmail) {
          r.used = 1;
        }
      });
      memPasswordResets.push({
        id: memPasswordResets.length + 1,
        email: cleanEmail,
        otp_code: otpCode,
        expires_at: expiresAt,
        used: 0,
        created_at: new Date()
      });
    }

    return {
      otp: otpCode,
      expiresAt,
      email: cleanEmail
    };
  },

  async verifyPasswordResetOtp(email, otpCode) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otpCode || '').trim();

    if (isConnectedToPostgres && pool) {
      const res = await pool.query(
        'SELECT * FROM password_resets WHERE LOWER(email) = $1 AND otp_code = $2 AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
        [cleanEmail, cleanOtp]
      );
      return res.rows.length > 0;
    }

    const record = memPasswordResets.find(r => 
      r.email.toLowerCase() === cleanEmail &&
      r.otp_code === cleanOtp &&
      r.used === 0 &&
      new Date(r.expires_at) > new Date()
    );

    return !!record;
  },

  async updateUserPassword(email, newPasswordHash) {
    const cleanEmail = (email || '').trim().toLowerCase();

    if (isConnectedToPostgres && pool) {
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE LOWER(email) = $2',
        [newPasswordHash, cleanEmail]
      );
      // Mark all OTPs as used
      await pool.query(
        'UPDATE password_resets SET used = 1 WHERE LOWER(email) = $1',
        [cleanEmail]
      );
      return true;
    }

    const user = memUsers.find(u => u.email.toLowerCase() === cleanEmail);
    if (user) {
      user.password_hash = newPasswordHash;
    }
    memPasswordResets.forEach(r => {
      if (r.email.toLowerCase() === cleanEmail) {
        r.used = 1;
      }
    });
    return true;
  },

  SYSTEM_WHATSAPP_NUMBER,

  // Orders and Fulfillment
  async createOrder({ userId, total, address, phone, paymentReference, items }) {
    const numericTotal = parseFloat(total) || 0;
    const user = await this.findUserById(userId);
    const userName = user ? user.name : 'Customer';

    if (isConnectedToPostgres && pool) {
      const orderRes = await pool.query(`
        INSERT INTO orders (
          user_id, buyer_id, buyer_name, user_name,
          phone, buyer_phone, address, delivery_address,
          total, total_amount, payment_reference, payment_method, status
        )
        VALUES (
          $1::INT, $2::INT, $3::VARCHAR, $4::VARCHAR,
          $5::VARCHAR, $6::VARCHAR, $7::TEXT, $8::TEXT,
          $9::NUMERIC, $10::NUMERIC, $11::VARCHAR, 'Mobile Money', 'Pending'
        )
        RETURNING id
      `, [
        userId, userId, userName, userName,
        phone || '', phone || '', address || '', address || '',
        numericTotal, numericTotal, paymentReference || ''
      ]);

      const orderId = orderRes.rows[0].id;
      for (const item of items) {
        await pool.query(`
          INSERT INTO order_items (order_id, product_id, title, price, quantity, image, image_url)
          VALUES ($1::INT, $2::INT, $3::VARCHAR, $4::NUMERIC, $5::INT, $6::VARCHAR, $7::TEXT)
        `, [orderId, item.product_id, item.title, item.price, item.quantity, item.image || '', item.image || '']);

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
        message: `Your order of UGX ${Number(numericTotal).toLocaleString()} has been received and is queued for fulfillment.`,
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
      total: numericTotal,
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
      message: `Your order of UGX ${Number(numericTotal).toLocaleString()} has been received and is queued for fulfillment.`,
      type: 'order_status'
    });

    return orderId;
  },

  async updateOrderStatus(orderId, status) {
    if (isConnectedToPostgres && pool) {
      const res = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING user_id, buyer_id', [status, orderId]);
      if (res.rows.length > 0) {
        const uId = res.rows[0].user_id || res.rows[0].buyer_id;
        if (uId) {
          await this.createNotification({
            userId: uId,
            title: `🚚 Order #${orderId} Status: ${status}`,
            message: `Your order status has been updated to "${status}".`,
            type: 'order_status'
          });
        }
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
      try {
        const res = await pool.query(`
          SELECT 
            o.id,
            COALESCE(o.user_id, o.buyer_id) as user_id,
            COALESCE(o.total, o.total_amount, 0) as total,
            COALESCE(o.status, 'Pending') as status,
            COALESCE(o.address, o.delivery_address, '') as address,
            COALESCE(o.phone, o.buyer_phone, '') as phone,
            COALESCE(o.payment_reference, o.payment_method, '') as payment_reference,
            COALESCE(u.name, o.buyer_name, 'Guest User') as user_name,
            u.email as user_email,
            u.whatsapp_number,
            o.created_at
          FROM orders o
          LEFT JOIN users u ON COALESCE(o.user_id, o.buyer_id) = u.id
          ORDER BY o.created_at DESC
        `);
        const orders = res.rows;
        for (const ord of orders) {
          ord.total = parseFloat(ord.total) || 0;
          try {
            const itRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [ord.id]);
            ord.items = itRes.rows.map(it => ({
              ...it,
              price: parseFloat(it.price) || 0,
              image: it.image || it.image_url || 'phone-front.svg'
            }));
          } catch {
            ord.items = [];
          }
        }
        return orders;
      } catch (err) {
        console.warn('Postgres getAllOrders error:', err.message);
        return [];
      }
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
    const uId = parseInt(userId, 10);
    if (!uId) return [];

    if (isConnectedToPostgres && pool) {
      try {
        const ordersRes = await pool.query(`
          SELECT 
            o.id,
            COALESCE(o.user_id, o.buyer_id) as user_id,
            COALESCE(o.total, o.total_amount, 0) as total,
            COALESCE(o.status, 'Pending') as status,
            COALESCE(o.address, o.delivery_address, '') as address,
            COALESCE(o.phone, o.buyer_phone, '') as phone,
            COALESCE(o.payment_reference, o.payment_method, '') as payment_reference,
            o.created_at
          FROM orders o
          WHERE o.user_id = $1 OR o.buyer_id = $1
          ORDER BY o.created_at DESC
        `, [uId]);
        const userOrders = ordersRes.rows;
        for (const ord of userOrders) {
          ord.total = parseFloat(ord.total) || 0;
          try {
            const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [ord.id]);
            ord.items = itemsRes.rows.map(it => ({
              ...it,
              price: parseFloat(it.price) || 0,
              image: it.image || it.image_url || 'phone-front.svg'
            }));
          } catch {
            ord.items = [];
          }
        }
        return userOrders;
      } catch (err) {
        console.warn('Postgres getOrdersByUser error:', err.message);
        return [];
      }
    }

    return memOrders
      .filter(o => o.user_id === uId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Clear all products (for testing reset or user purge)
  async clearAllProducts() {
    if (isConnectedToPostgres && pool) {
      try { await pool.query('DELETE FROM price_change_requests'); } catch {}
      try { await pool.query('DELETE FROM order_items'); } catch {}
      try { await pool.query('DELETE FROM product_images'); } catch {}
      try { await pool.query('DELETE FROM products'); } catch {}
    }
    memProducts = [];
    memProductImages = [];
    memPriceChangeRequests = [];
    return true;
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

  getOwnerCommissionPercentage() {
    return ownerCommissionPercentage;
  },

  setOwnerCommissionPercentage(percentage) {
    const p = parseFloat(percentage);
    if (!isNaN(p) && p >= 0 && p <= 100) {
      ownerCommissionPercentage = p;
    }
    return ownerCommissionPercentage;
  },

  // Comprehensive System Analytics
  async getSystemStats() {
    let isDbHealthy = isConnectedToPostgres;
    let dbLatencyMs = null;

    if (isConnectedToPostgres && pool) {
      try {
        const start = Date.now();
        await pool.query('SELECT 1');
        dbLatencyMs = Date.now() - start;
        isDbHealthy = true;
      } catch (e) {
        console.warn('Database health ping failed:', e.message);
        isDbHealthy = false;
      }
    }

    const products = await this.getProducts();
    const orders = await this.getAllOrders();
    const tickets = await this.getAllSupportTickets();
    const returns = await this.getAllReturnsRefunds();
    const campaigns = await this.getAllCampaigns();

    const totalProducts = products.length;
    const activeProducts = products.filter(p => (p.quantity || 0) > 0 && p.approved === 1).length;
    const lowStockProducts = products.filter(p => (p.quantity || 0) > 0 && (p.quantity || 0) <= 3);
    const outOfStockProducts = products.filter(p => (p.quantity || 0) === 0);
    const totalStockUnits = products.reduce((sum, p) => sum + (p.quantity || 0), 0);
    
    // Total Expected Revenue across ALL uploaded products in the marketplace
    const totalExpectedCatalogRevenue = products.reduce((sum, p) => sum + ((p.price || 0) * (p.quantity || 0)), 0);
    const ownerShareAmount = totalExpectedCatalogRevenue * (ownerCommissionPercentage / 100);
    const sellersShareAmount = totalExpectedCatalogRevenue - ownerShareAmount;

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
      financialForecast: {
        totalExpectedCatalogRevenue,
        ownerCommissionPercentage,
        ownerShareAmount,
        sellersShareAmount,
        ownerPhoneNumber: '+256 763 480495',
        ownerWhatsApp: '256763480495'
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
        totalInventoryValue: totalExpectedCatalogRevenue,
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
      },
      database: {
        isConnected: isDbHealthy,
        latencyMs: dbLatencyMs,
        type: isDbHealthy ? 'Supabase PostgreSQL (Cloud Active & Persistent)' : 'Temporary In-Memory Fallback',
        hasConnectionString: !!rawConnectionString
      }
    };
  }
};

module.exports = { db, initDatabase };
