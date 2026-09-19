const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { generateOtp } = require('./config');
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

// Helper to execute PostgreSQL queries with automatic retry and error recovery
async function executePgQuery(text, params = []) {
  if (!pool) {
    initializePool(rawConnectionString);
  }
  if (!pool) {
    throw new Error('Database connection pool is not initialized.');
  }

  try {
    const res = await pool.query(text, params);
    isConnectedToPostgres = true;
    lastDbSuccessTime = new Date();
    lastDbError = null;
    return res;
  } catch (err) {
    console.warn(`[PG QUERY WARNING] Query "${text.trim().substring(0, 60)}..." error:`, err.message);
    const isConnErr = err.code === 'ECONNRESET' || 
                      err.code === '57P01' || 
                      err.code === '08006' || 
                      err.code === '08001' || 
                      err.message.includes('Connection terminated') || 
                      err.message.includes('closed') ||
                      err.message.includes('timeout');

    if (isConnErr) {
      console.log('[PG RECONNECT] Re-initializing pool and retrying query...');
      try {
        initializePool(rawConnectionString);
        if (pool) {
          const retryRes = await pool.query(text, params);
          isConnectedToPostgres = true;
          lastDbSuccessTime = new Date();
          lastDbError = null;
          return retryRes;
        }
      } catch (retryErr) {
        lastDbError = retryErr.message;
        console.error('[PG RETRY FAILED]', retryErr.message);
      }
    }
    lastDbError = err.message;
    throw err;
  }
}

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
          image_url TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INT,
          user_name VARCHAR(255),
          user_email VARCHAR(255),
          phone VARCHAR(100),
          whatsapp_number VARCHAR(100),
          total NUMERIC(15,2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Pending',
          payment_method VARCHAR(100),
          payment_status VARCHAR(50) DEFAULT 'Pending',
          delivery_address TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INT,
          product_id INT,
          title VARCHAR(255),
          price NUMERIC(15,2) DEFAULT 0,
          quantity INT DEFAULT 1,
          image VARCHAR(255),
          image_url TEXT
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INT,
          title VARCHAR(255),
          message TEXT,
          type VARCHAR(50) DEFAULT 'system',
          is_read INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          sender_id INT,
          receiver_id INT,
          product_id INT,
          message TEXT,
          is_read INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          user_id INT,
          user_name VARCHAR(255),
          user_email VARCHAR(255),
          subject VARCHAR(255),
          message TEXT,
          status VARCHAR(50) DEFAULT 'Open',
          admin_reply TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS returns_refunds (
          id SERIAL PRIMARY KEY,
          order_id INT,
          user_id INT,
          reason TEXT,
          amount NUMERIC(15,2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Pending',
          admin_note TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS campaigns (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          description TEXT,
          discount NUMERIC(10,2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'Active',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS price_change_requests (
          id SERIAL PRIMARY KEY,
          product_id INT,
          seller_id INT,
          current_price NUMERIC(15,2) DEFAULT 0,
          proposed_price NUMERIC(15,2) DEFAULT 0,
          reason TEXT,
          status VARCHAR(50) DEFAULT 'Pending',
          resolved_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS password_resets (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          otp_code VARCHAR(20) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 2. Add missing columns to existing tables
      const columnAlterStatements = [
        // users table
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'customer'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INT DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN DEFAULT TRUE",

        // products table
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS location VARCHAR(255) DEFAULT 'Kampala, Uganda'",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS condition VARCHAR(100) DEFAULT 'Brand New'",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS phone VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_phone VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS payment_code VARCHAR(100)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS approved INT DEFAULT 1",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id INT",

        // orders table
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_email VARCHAR(255)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'Pending'",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",

        // order_items table
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
          await client.query(
            'INSERT INTO categories (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
            [cat.id, cat.name]
          );
        }
        try {
          await client.query(
            "SELECT setval('categories_id_seq', (SELECT COALESCE(MAX(id), 1) FROM categories))"
          );
        } catch {}
      }

      // 4. Seed admin user if not already present
      const userRes = await client.query(
        'SELECT * FROM users WHERE LOWER(email) = $1',
        [ADMIN_USERNAME.toLowerCase()]
      );

      if (userRes.rows.length === 0) {
        try {
          await client.query(`
            INSERT INTO users (
              name,
              email,
              password_hash,
              role,
              is_admin,
              phone,
              whatsapp_number,
              has_whatsapp
            )
            VALUES (
              $1,
              $2,
              $3,
              'admin',
              1,
              '+256 763 480495',
              '256763480495',
              TRUE
            )
          `, [
            'EasyMarket Admin',
            ADMIN_USERNAME.toLowerCase(),
            adminPasswordHash
          ]);
        } catch (err) {
          console.warn('Admin user insert fallback:', err.message);

          await client.query(`
            INSERT INTO users (
              name,
              email,
              password_hash,
              role
            )
            VALUES ($1, $2, $3, 'admin')
          `, [
            'EasyMarket Admin',
            ADMIN_USERNAME.toLowerCase(),
            adminPasswordHash
          ]);
        }
      }

      // 5. Auto-repair & link unassigned products to verified seller accounts
      try {
        await client.query(`
          UPDATE products p
          SET seller_id = u.id
          FROM users u
          WHERE p.seller_id IS NULL 
            AND u.is_admin = 0
            AND (
              RIGHT(
                REGEXP_REPLACE(
                  COALESCE(p.phone,''),
                  '[^0-9]',
                  '',
                  'g'
                ),
                9
              ) = RIGHT(
                REGEXP_REPLACE(
                  COALESCE(u.phone,''),
                  '[^0-9]',
                  '',
                  'g'
                ),
                9
              )
              OR RIGHT(
                REGEXP_REPLACE(
                  COALESCE(p.seller_phone,''),
                  '[^0-9]',
                  '',
                  'g'
                ),
                9
              ) = RIGHT(
                REGEXP_REPLACE(
                  COALESCE(u.phone,''),
                  '[^0-9]',
                  '',
                  'g'
                ),
                9
              )
            )
        `);

        // Ensure all active products have approved=1 and quantity >= 1
        await client.query(`
          UPDATE products 
          SET approved = 1 
          WHERE approved IS NULL OR approved = 0;
        `);

        await client.query(`
          UPDATE products 
          SET quantity = 1 
          WHERE quantity IS NULL OR quantity < 0;
        `);
      } catch (linkErr) {
        console.warn(
          'Non-blocking product auto-link notice:',
          linkErr.message
        );
      }

      // 6. Pre-cache all products & categories from PostgreSQL into memory cache
      try {
        const catRes = await client.query(
          'SELECT * FROM categories ORDER BY id ASC'
        );

        if (catRes.rows.length > 0) {
          memCategories = catRes.rows;
        }

        const prodRes = await client.query(`
          SELECT
            p.*,
            c.name as category_name,
            u.name as seller_name,
            u.email as seller_email,
            u.phone as seller_user_phone,
            u.whatsapp_number as seller_user_whatsapp
          FROM products p 
          LEFT JOIN categories c ON p.category_id = c.id 
          LEFT JOIN users u ON p.seller_id = u.id
          ORDER BY p.id DESC
        `);

        if (prodRes.rows.length > 0) {
          memProducts = prodRes.rows.map(r => ({
            ...r,
            price: isNaN(parseFloat(r.price))
              ? 0
              : parseFloat(r.price),

            quantity: isNaN(parseInt(r.quantity, 10))
              ? 1
              : Math.max(0, parseInt(r.quantity, 10)),

            approved:
              (
                r.approved === true ||
                r.approved === 1 ||
                r.approved === '1' ||
                r.approved == null ||
                r.approved === 'true'
              )
                ? 1
                : 0,

            category_name: r.category_name || 'General'
          }));
        }
      } catch (cacheErr) {
        console.warn(
          'Memory cache warm-up notice:',
          cacheErr.message
        );
      }

      isConnectedToPostgres = true;
      lastDbError = null;
      lastDbErrorCode = null;
      lastDbSuccessTime = new Date();

      console.log(
        '✅ PostgreSQL / Supabase Database Connected & Synchronized Successfully!'
      );

    } finally {
      client.release();
    }

  } catch (err) {
    lastDbError = err.message;
    lastDbErrorCode = err.code || null;

    console.warn(
      'Could not connect to PostgreSQL server. Falling back to in-memory store:',
      err.message
    );

    isConnectedToPostgres = false;
  }
}

function formatProductRow(r) {
  if (!r) return null;

  const rawImg = r.image_url || r.image;

  let finalImage = 'phone-front.svg';

  if (
    rawImg &&
    (
      rawImg.startsWith('data:') ||
      rawImg.startsWith('http') ||
      rawImg.startsWith('/')
    )
  ) {
    finalImage = rawImg;
  } else if (rawImg) {
    finalImage = `/uploads/${rawImg}`;
  }

  const sellerWa =
    r.whatsapp_number ||
    r.seller_user_whatsapp ||
    r.seller_user_phone ||
    r.seller_phone ||
    r.phone ||
    '';

  return {
    ...r,
    image: finalImage,
    image_url: finalImage,

    price: isNaN(parseFloat(r.price))
      ? 0
      : parseFloat(r.price),

    quantity: isNaN(parseInt(r.quantity, 10))
      ? 1
      : Math.max(0, parseInt(r.quantity, 10)),

    approved:
      (
        r.approved === true ||
        r.approved === 1 ||
        r.approved === '1' ||
        r.approved == null ||
        r.approved === 'true'
      )
        ? 1
        : 0,

    category_name: r.category_name || 'General',
    whatsapp_number: sellerWa
  };
}

// Format Uganda WhatsApp phone number cleanly
// e.g. "+256 701 234567" or "0701234567" -> "256701234567"
function sanitizeWhatsAppNumber(phone) {
  if (!phone) return '';

  let cleaned = phone
    .toString()
    .replace(/[^0-9]/g, '');

  if (!cleaned) return '';

  if (cleaned.startsWith('00256')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('256')) {
    // Keep 256...
  } else if (
    cleaned.startsWith('0') &&
    (cleaned.length === 10 || cleaned.length === 11)
  ) {
    cleaned = '256' + cleaned.substring(1);
  } else if (cleaned.length === 9) {
    cleaned = '256' + cleaned;
  }

  return cleaned;
}

const db = {
  sanitizeWhatsAppNumber,

  async getCategories() {
    try {
      const res = await executePgQuery(
        'SELECT * FROM categories ORDER BY id ASC'
      );

      if (res.rows.length > 0) {
        memCategories = res.rows;
      }

      return res.rows;
    } catch (err) {
      return memCategories;
    }
  },

  async getCategoryById(id) {
    const cId = parseInt(id, 10);

    if (!cId) return null;

    try {
      const res = await executePgQuery(
        'SELECT * FROM categories WHERE id = $1',
        [cId]
      );

      return res.rows[0] || null;
    } catch (err) {
      return memCategories.find(c => c.id === cId) || null;
    }
  },

  async getProducts(filterFn = null) {
    try {
      const res = await executePgQuery(`
        SELECT
          p.*,
          c.name as category_name,
          u.name as seller_name,
          u.email as seller_email,
          u.phone as seller_user_phone,
          u.whatsapp_number as seller_user_whatsapp
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        LEFT JOIN users u ON p.seller_id = u.id
        ORDER BY p.id DESC
      `);

      let list = res.rows.map(formatProductRow);

      // Keep memory cache updated with real database records
      memProducts = [...list];

      if (filterFn) {
        list = list.filter(filterFn);
      }

      return list;
    } catch (err) {
      console.warn(
        'Using cached products due to fetch error:',
        err.message
      );

      let list = memProducts.map(p => {
        const cat = memCategories.find(
          c => c.id === p.category_id
        );

        return formatProductRow({
          ...p,
          category_name:
            p.category_name ||
            (cat ? cat.name : 'General')
        });
      });

      if (filterFn) {
        list = list.filter(filterFn);
      }

      return list;
    }
  },
    async getAllProducts() {
    return this.getProducts();
  },

  async getProductById(id) {
    const pId = parseInt(id, 10);
    if (!pId) return null;

    try {
      const res = await executePgQuery(`
        SELECT p.*, c.name as category_name, u.name as seller_name, u.email as seller_email, u.phone as seller_user_phone, u.whatsapp_number as seller_user_whatsapp
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        LEFT JOIN users u ON p.seller_id = u.id
        WHERE p.id = $1
      `, [pId]);

      if (res.rows.length === 0) return null;

      return formatProductRow(res.rows[0]);

    } catch (err) {
      const p = memProducts.find(item => item.id === pId);

      if (!p) return null;

      const cat = memCategories.find(c => c.id === p.category_id);

      return formatProductRow({
        ...p,
        category_name: cat ? cat.name : (p.category_name || 'General')
      });
    }
  },

  async getProductImages(productId) {
    const pId = parseInt(productId, 10);
    if (!pId) return [];

    try {
      const res = await executePgQuery(
        'SELECT id, product_id, image_path, image_url, is_main FROM product_images WHERE product_id = $1 ORDER BY is_main DESC, id ASC',
        [pId]
      );

      if (res.rows.length > 0) {
        return res.rows.map(img => {
          const raw = img.image_url || img.image_path;

          let formatted = '/phone-front.svg';

          if (
            raw &&
            (
              raw.startsWith('data:') ||
              raw.startsWith('http') ||
              raw.startsWith('/')
            )
          ) {
            formatted = raw;
          } else if (raw) {
            formatted = `/uploads/${raw}`;
          }

          return {
            ...img,
            image_path: formatted,
            image_url: formatted
          };
        });
      }

      const prodRes = await executePgQuery(
        'SELECT image_url, image FROM products WHERE id = $1',
        [pId]
      );

      if (prodRes.rows.length > 0) {
        const raw =
          prodRes.rows[0].image_url ||
          prodRes.rows[0].image;

        let formatted = '/phone-front.svg';

        if (
          raw &&
          (
            raw.startsWith('data:') ||
            raw.startsWith('http') ||
            raw.startsWith('/')
          )
        ) {
          formatted = raw;
        } else if (raw) {
          formatted = `/uploads/${raw}`;
        }

        return [{
          id: 0,
          product_id: pId,
          image_path: formatted,
          image_url: formatted,
          is_main: 1
        }];
      }

      return [];

    } catch (err) {
      const memList = memProductImages.filter(
        img => img.product_id === pId
      );

      if (memList.length > 0) {
        return memList.map(img => {
          const raw =
            img.image_url ||
            img.image_path;

          let formatted = '/phone-front.svg';

          if (
            raw &&
            (
              raw.startsWith('data:') ||
              raw.startsWith('http') ||
              raw.startsWith('/')
            )
          ) {
            formatted = raw;
          } else if (raw) {
            formatted = `/uploads/${raw}`;
          }

          return {
            ...img,
            image_path: formatted,
            image_url: formatted
          };
        });
      }

      const p = memProducts.find(
        item => item.id === pId
      );

      if (p) {
        const raw =
          p.image_url ||
          p.image;

        let formatted = '/phone-front.svg';

        if (
          raw &&
          (
            raw.startsWith('data:') ||
            raw.startsWith('http') ||
            raw.startsWith('/')
          )
        ) {
          formatted = raw;
        } else if (raw) {
          formatted = `/uploads/${raw}`;
        }

        return [{
          id: 0,
          product_id: pId,
          image_path: formatted,
          image_url: formatted,
          is_main: 1
        }];
      }

      return [];
    }
  },

  async addProduct(data) {
    const {
      title,
      description,
      price,
      image,
      image_url,
      category_id,
      location,
      condition,
      phone,
      seller_phone,
      whatsapp_number,
      payment_code,
      approved = 1,
      quantity = 1,
      seller_id
    } = data || {};

    try {
      const res = await executePgQuery(`
        INSERT INTO products (
          title,
          description,
          price,
          image,
          image_url,
          category_id,
          location,
          condition,
          phone,
          seller_phone,
          whatsapp_number,
          payment_code,
          approved,
          quantity,
          seller_id
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        )
        RETURNING *
      `, [
        title,
        description || '',
        parseFloat(price) || 0,
        image || null,
        image_url || image || null,
        category_id || null,
        location || 'Kampala, Uganda',
        condition || 'Brand New',
        phone || null,
        seller_phone || phone || null,
        whatsapp_number || '',
        payment_code || null,
        approved ? 1 : 0,
        parseInt(quantity, 10) || 1,
        seller_id || null
      ]);

      const product = formatProductRow(res.rows[0]);

      memProducts.unshift(product);

      return product;

    } catch (err) {
      const newProduct = {
        id: memNextProdId++,
        title,
        description: description || '',
        price: parseFloat(price) || 0,
        image: image || image_url || 'phone-front.svg',
        image_url: image_url || image || 'phone-front.svg',
        category_id: category_id || null,
        location: location || 'Kampala, Uganda',
        condition: condition || 'Brand New',
        phone: phone || '',
        seller_phone: seller_phone || phone || '',
        whatsapp_number: whatsapp_number || '',
        payment_code: payment_code || '',
        approved: approved ? 1 : 0,
        quantity: parseInt(quantity, 10) || 1,
        seller_id: seller_id || null,
        created_at: new Date()
      };

      memProducts.unshift(newProduct);

      return formatProductRow(newProduct);
    }
  },

  async updateProduct(id, data) {
    const pId = parseInt(id, 10);

    if (!pId) {
      return null;
    }

    const existing = await this.getProductById(pId);

    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...data,
      id: pId
    };

    try {
      const res = await executePgQuery(`
        UPDATE products
        SET
          title = $1,
          description = $2,
          price = $3,
          image = $4,
          image_url = $5,
          category_id = $6,
          location = $7,
          condition = $8,
          phone = $9,
          seller_phone = $10,
          whatsapp_number = $11,
          payment_code = $12,
          approved = $13,
          quantity = $14,
          seller_id = $15
        WHERE id = $16
        RETURNING *
      `, [
        updated.title,
        updated.description || '',
        parseFloat(updated.price) || 0,
        updated.image || null,
        updated.image_url || updated.image || null,
        updated.category_id || null,
        updated.location || 'Kampala, Uganda',
        updated.condition || 'Brand New',
        updated.phone || null,
        updated.seller_phone || updated.phone || null,
        updated.whatsapp_number || '',
        updated.payment_code || null,
        updated.approved ? 1 : 0,
        parseInt(updated.quantity, 10) || 1,
        updated.seller_id || null,
        pId
      ]);

      if (res.rows.length > 0) {
        const product = formatProductRow(res.rows[0]);

        const index = memProducts.findIndex(
          p => p.id === pId
        );

        if (index >= 0) {
          memProducts[index] = product;
        }

        return product;
      }

    } catch (err) {
      console.warn(
        'Database update failed, using memory fallback:',
        err.message
      );
    }

    const index = memProducts.findIndex(
      p => p.id === pId
    );

    if (index >= 0) {
      memProducts[index] = updated;
      return formatProductRow(updated);
    }

    return formatProductRow(updated);
  },

  async deleteProduct(id) {
    const pId = parseInt(id, 10);

    if (!pId) {
      return false;
    }

    try {
      await executePgQuery(
        'DELETE FROM product_images WHERE product_id = $1',
        [pId]
      );

      await executePgQuery(
        'DELETE FROM products WHERE id = $1',
        [pId]
      );

      memProducts = memProducts.filter(
        p => p.id !== pId
      );

      memProductImages = memProductImages.filter(
        img => img.product_id !== pId
      );

      return true;

    } catch (err) {
      console.warn(
        'Database product delete failed:',
        err.message
      );

      const before = memProducts.length;

      memProducts = memProducts.filter(
        p => p.id !== pId
      );

      memProductImages = memProductImages.filter(
        img => img.product_id !== pId
      );

      return memProducts.length < before;
    }
  },

  async addProductImage(data) {
    const {
      product_id,
      image_path,
      image_url,
      is_main = false
    } = data || {};

    const pId = parseInt(product_id, 10);

    if (!pId) {
      return null;
    }

    try {
      const res = await executePgQuery(`
        INSERT INTO product_images (
          product_id,
          image_path,
          image_url,
          is_main
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        pId,
        image_path || null,
        image_url || image_path || null,
        is_main ? true : false
      ]);

      const row = res.rows[0];

      memProductImages.push(row);

      return row;

    } catch (err) {
      const row = {
        id: memNextImgId++,
        product_id: pId,
        image_path: image_path || null,
        image_url: image_url || image_path || null,
        is_main: is_main ? true : false
      };

      memProductImages.push(row);

      return row;
    }
  },

  async deleteProductImage(id) {
    const imgId = parseInt(id, 10);

    if (!imgId) {
      return false;
    }

    try {
      await executePgQuery(
        'DELETE FROM product_images WHERE id = $1',
        [imgId]
      );

      memProductImages = memProductImages.filter(
        img => img.id !== imgId
      );

      return true;

    } catch (err) {
      const before = memProductImages.length;

      memProductImages = memProductImages.filter(
        img => img.id !== imgId
      );

      return memProductImages.length < before;
    }
  },

  async getUsers() {
    try {
      const res = await executePgQuery(
        'SELECT * FROM users ORDER BY id ASC'
      );

      if (res.rows.length > 0) {
        memUsers = res.rows;
      }

      return res.rows;

    } catch (err) {
      return memUsers;
    }
  },

  async getUserById(id) {
    const userId = parseInt(id, 10);

    if (!userId) {
      return null;
    }

    try {
      const res = await executePgQuery(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );

      return res.rows[0] || null;

    } catch (err) {
      return memUsers.find(
        u => u.id === userId
      ) || null;
    }
  },

  async getUserByEmail(email) {
    const cleanEmail =
      (email || '').trim().toLowerCase();

    if (!cleanEmail) {
      return null;
    }

    try {
      const res = await executePgQuery(
        'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
        [cleanEmail]
      );

      return res.rows[0] || null;

    } catch (err) {
      return memUsers.find(
        u =>
          (u.email || '').toLowerCase() === cleanEmail
      ) || null;
    }
  },

  async createUser(data) {
    const {
      name,
      email,
      password_hash,
      role = 'customer',
      is_admin = 0,
      phone = '',
      whatsapp_number = '',
      has_whatsapp = true
    } = data || {};

    const cleanEmail =
      (email || '').trim().toLowerCase();

    try {
      const res = await executePgQuery(`
        INSERT INTO users (
          name,
          email,
          password_hash,
          role,
          is_admin,
          phone,
          whatsapp_number,
          has_whatsapp
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [
        name,
        cleanEmail,
        password_hash,
        role,
        is_admin ? 1 : 0,
        phone,
        whatsapp_number,
        has_whatsapp
      ]);

      const user = res.rows[0];

      memUsers.push(user);

      return user;

    } catch (err) {
      const existing = memUsers.find(
        u =>
          (u.email || '').toLowerCase() === cleanEmail
      );

      if (existing) {
        throw new Error('Email already registered');
      }

      const user = {
        id: memNextUserId++,
        name,
        email: cleanEmail,
        password_hash,
        role,
        is_admin: is_admin ? 1 : 0,
        phone,
        whatsapp_number,
        has_whatsapp,
        created_at: new Date()
      };

      memUsers.push(user);

      return user;
    }
  },
        const p = memProducts.find(item => item.id === pId);
      if (p && (p.image || p.image_url)) {
        const raw = p.image_url || p.image;
        let formatted = '/phone-front.svg';

        if (
          raw &&
          (
            raw.startsWith('data:') ||
            raw.startsWith('http') ||
            raw.startsWith('/')
          )
        ) {
          formatted = raw;
        } else if (raw) {
          formatted = `/uploads/${raw}`;
        }

        return [{
          id: 0,
          product_id: pId,
          image_path: formatted,
          image_url: formatted,
          is_main: 1
        }];
      }

      return [];
    }
  },

  async getSimilarProducts(categoryId, currentId, limit = 4) {
    const cId = parseInt(categoryId, 10);
    const pId = parseInt(currentId, 10);

    try {
      const res = await executePgQuery(`
        SELECT p.*, c.name as category_name
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.category_id = $1
          AND p.id != $2
          AND (
            p.approved = 1
            OR p.approved IS NULL
            OR p.approved = true
          )
        ORDER BY p.id DESC
        LIMIT $3
      `, [cId, pId, limit]);

      return res.rows.map(formatProductRow);

    } catch (err) {
      return memProducts
        .filter(
          p =>
            p.category_id === cId &&
            p.id !== pId &&
            (p.approved === 1 || p.approved == null)
        )
        .slice(0, limit)
        .map(formatProductRow);
    }
  },

  async createProduct({
    title,
    description,
    price,
    category_id,
    phone,
    whatsapp_number,
    location,
    payment_code,
    quantity,
    images,
    seller_id,
    condition = 'Brand New'
  }) {
    const mainImageItem =
      (images && images.length > 0)
        ? images[0]
        : null;

    const mainImageFile =
      mainImageItem
        ? (
            typeof mainImageItem === 'object'
              ? mainImageItem.filename
              : mainImageItem
          )
        : 'phone-front.svg';

    const mainImageUrl =
      mainImageItem
        ? (
            typeof mainImageItem === 'object'
              ? (
                  mainImageItem.dataUrl ||
                  mainImageItem.filename
                )
              : mainImageItem
          )
        : '/phone-front.svg';

    const wa = sanitizeWhatsAppNumber(
      whatsapp_number || phone || ''
    );

    const parsedPrice =
      isNaN(parseFloat(price))
        ? 0
        : Math.max(0, parseFloat(price));

    const parsedQty =
      isNaN(parseInt(quantity, 10))
        ? 1
        : Math.max(1, parseInt(quantity, 10));

    let parsedCatId =
      parseInt(category_id, 10) || 1;

    let validSellerId =
      seller_id
        ? parseInt(seller_id, 10)
        : null;

    try {
      // 1. Sanitize category ID against PostgreSQL categories
      const catRes = await executePgQuery(
        'SELECT id FROM categories WHERE id = $1',
        [parsedCatId]
      );

      if (catRes.rows.length === 0) {
        const firstCat = await executePgQuery(
          'SELECT id FROM categories ORDER BY id ASC LIMIT 1'
        );

        if (firstCat.rows.length > 0) {
          parsedCatId = firstCat.rows[0].id;
        }
      }

      // 2. Resolve seller_id to ensure proper linkage
      if (validSellerId) {
        const userRes = await executePgQuery(
          'SELECT id FROM users WHERE id = $1',
          [validSellerId]
        );

        if (userRes.rows.length === 0) {
          validSellerId = null;
        }
      }

      // If seller_id is still not set, match user by phone
      if (!validSellerId && phone) {
        const cleanP =
          phone.replace(/[^0-9]/g, '');

        if (cleanP.length >= 9) {
          const uRes = await executePgQuery(`
            SELECT id FROM users 
            WHERE is_admin = 0
              AND (
                RIGHT(
                  REGEXP_REPLACE(
                    COALESCE(phone,''),
                    '[^0-9]',
                    '',
                    'g'
                  ),
                  9
                ) = $1
                OR RIGHT(
                  REGEXP_REPLACE(
                    COALESCE(whatsapp_number,''),
                    '[^0-9]',
                    '',
                    'g'
                  ),
                  9
                ) = $1
              )
            LIMIT 1
          `, [cleanP.slice(-9)]);

          if (uRes.rows.length > 0) {
            validSellerId =
              uRes.rows[0].id;
          }
        }
      }

      const res = await executePgQuery(`
        INSERT INTO products (
          title,
          description,
          price,
          category_id,
          phone,
          seller_phone,
          whatsapp_number,
          location,
          condition,
          image,
          image_url,
          payment_code,
          quantity,
          approved,
          seller_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          1,
          $14
        )
        RETURNING id
      `, [
        title,
        description,
        parsedPrice,
        parsedCatId,
        phone,
        phone,
        wa,
        location || 'Kampala, Uganda',
        condition,
        mainImageFile,
        mainImageUrl,
        payment_code,
        parsedQty,
        validSellerId
      ]);

      const newProdId =
        res.rows[0].id;

      if (images && images.length > 0) {
        for (
          let i = 0;
          i < images.length;
          i++
        ) {
          const item = images[i];

          const fn =
            typeof item === 'object'
              ? item.filename
              : item;

          const dUrl =
            typeof item === 'object'
              ? (
                  item.dataUrl ||
                  item.filename
                )
              : item;

          await executePgQuery(`
            INSERT INTO product_images (
              product_id,
              image_path,
              image_url,
              is_main
            )
            VALUES ($1, $2, $3, $4)
          `, [
            newProdId,
            fn,
            dUrl,
            i === 0
          ]);
        }
      }

      // Keep in-memory cache synchronized with the new product
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
        image: mainImageFile,
        image_url: mainImageUrl,
        payment_code,
        quantity: parsedQty,
        approved: 1,
        seller_id: validSellerId,
        created_at: new Date()
      });

      return newProdId;

    } catch (err) {
      console.error(
        'Failed to create product in PostgreSQL, using in-memory store:',
        err.message
      );

      const newProdId =
        memNextProdId++;

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
        image: mainImageFile,
        image_url: mainImageUrl,
        payment_code,
        quantity: parsedQty,
        approved: 1,
        seller_id: validSellerId || 2,
        created_at: new Date()
      });

      if (images && images.length > 0) {
        images.forEach((item, index) => {
          const fn =
            typeof item === 'object'
              ? item.filename
              : item;

          const dUrl =
            typeof item === 'object'
              ? (
                  item.dataUrl ||
                  item.filename
                )
              : item;

          memProductImages.push({
            id: memNextImgId++,
            product_id: newProdId,
            image_path: fn,
            image_url: dUrl,
            is_main: index === 0 ? 1 : 0
          });
        });
      }

      return newProdId;
    }
  },

  async getAvailableProducts() {
    return this.getProducts(
      p =>
        p.quantity > 0 &&
        (
          p.approved === 1 ||
          p.approved === true
        )
    );
  },

  async getSoldProducts() {
    return this.getProducts(
      p => p.quantity <= 0
    );
  },

  async getProductsBySeller(sellerId) {
    const sId =
      parseInt(sellerId, 10);

    if (!sId) return [];

    let sellerUser = null;

    try {
      sellerUser =
        await this.findUserById(sId);
    } catch {}

    const cleanUserPhone =
      sellerUser &&
      sellerUser.phone
        ? sellerUser.phone.replace(
            /[^0-9]/g,
            ''
          )
        : '';

    const cleanUserWa =
      sellerUser &&
      sellerUser.whatsapp_number
        ? sellerUser.whatsapp_number.replace(
            /[^0-9]/g,
            ''
          )
        : '';

    return this.getProducts(p => {

      // 1. Direct seller_id match
      if (
        p.seller_id &&
        parseInt(p.seller_id, 10) === sId
      ) {
        return true;
      }

      // 2. Phone match against registered seller phone
      if (
        cleanUserPhone &&
        cleanUserPhone.length >= 9
      ) {
        const pPhone =
          (
            p.phone ||
            p.seller_phone ||
            ''
          ).replace(
            /[^0-9]/g,
            ''
          );

        if (
          pPhone &&
          (
            pPhone.endsWith(
              cleanUserPhone.slice(-9)
            ) ||
            cleanUserPhone.endsWith(
              pPhone.slice(-9)
            )
          )
        ) {
          return true;
        }
      }

      // 3. WhatsApp number match
      if (
        cleanUserWa &&
        cleanUserWa.length >= 9 &&
        cleanUserWa !== '256763480495'
      ) {
        const pWa =
          (
            p.whatsapp_number ||
            ''
          ).replace(
            /[^0-9]/g,
            ''
          );

        if (
          pWa &&
          (
            pWa.endsWith(
              cleanUserWa.slice(-9)
            ) ||
            cleanUserWa.endsWith(
              pWa.slice(-9)
            )
          )
        ) {
          return true;
        }
      }

      return false;
    });
  },

  async quickUpdateProduct(
    productId,
    {
      title,
      price,
      quantity,
      approved
    }
  ) {
    if (
      isConnectedToPostgres &&
      pool
    ) {
      await pool.query(`
        UPDATE products 
        SET
          title = COALESCE($1, title),
          price = COALESCE($2, price),
          quantity = COALESCE($3, quantity),
          approved = COALESCE($4, approved)
        WHERE id = $5
      `, [
        title || null,
        price || null,
        quantity !== undefined
          ? quantity
          : null,
        approved !== undefined
          ? approved
          : null,
        productId
      ]);

      return;
    }

    const prod =
      memProducts.find(
        p => p.id === productId
      );

    if (prod) {
      if (title !== undefined) {
        prod.title = title;
      }

      if (price !== undefined) {
        prod.price =
          parseFloat(price);
      }

      if (quantity !== undefined) {
        prod.quantity =
          Math.max(
            0,
            parseInt(quantity, 10)
          );
      }

      if (approved !== undefined) {
        prod.approved =
          parseInt(approved, 10);
      }

      if (prod.quantity === 0) {
        prod.approved = 0;
      }
    }
  },

  // Seller Price Update
  // Only publisher/seller can change
  // their own product's price
  async updateProductPriceBySeller(
    productId,
    sellerId,
    newPrice,
    newQuantity = null
  ) {
    const pId =
      parseInt(productId, 10);

    const sId =
      parseInt(sellerId, 10);

    const parsedPrice =
      parseFloat(newPrice);

    if (
      isNaN(parsedPrice) ||
      parsedPrice <= 0
    ) {
      return {
        success: false,
        error:
          'Price must be a valid positive number.'
      };
    }

    const prod =
      await this.getProductById(pId);

    if (!prod) {
      return {
        success: false,
        error:
          'Product not found.'
      };
    }

    // Security check:
    // Must be the owner/seller who published it
    if (
      prod.seller_id &&
      prod.seller_id !== sId
    ) {
      return {
        success: false,
        error:
          'Permission Denied: You can only edit prices of products that you published.'
      };
    }

    if (
      isConnectedToPostgres &&
      pool
    ) {
      let q =
        'UPDATE products SET price = $1';

      const params = [
        parsedPrice
      ];

      if (
        newQuantity !== null &&
        !isNaN(
          parseInt(
            newQuantity,
            10
          )
        )
      ) {
        params.push(
          Math.max(
            0,
            parseInt(
              newQuantity,
              10
            )
          )
        );

        q += `, quantity = $${params.length}`;
      }

      params.push(pId);

      q += ` WHERE id = $${params.length}`;

      await pool.query(
        q,
        params
      );

    } else {
      const mProd =
        memProducts.find(
          p => p.id === pId
        );

      if (mProd) {
        mProd.price =
          parsedPrice;

        if (
          newQuantity !== null &&
          !isNaN(
            parseInt(
              newQuantity,
              10
            )
          )
        ) {
          mProd.quantity =
            Math.max(
              0,
              parseInt(
                newQuantity,
                10
              )
            );
        }
      }
    }
  },        await pool.query(
          'UPDATE price_change_requests SET status = $1, resolved_at = NOW() WHERE id = $2',
          ['Rejected', reqId]
        );
      } else {
        request.status = 'Rejected';
        request.resolved_at = new Date();
      }

      // Notify seller
      await this.createNotification({
        userId: sId,
        title: '❌ Price Adjustment Declined',
        message: `You declined the proposed price change for "${prodTitle}". The product price remains at UGX ${Number(request.current_price).toLocaleString()}.`,
        type: 'price_rejected'
      });

      // Notify Admin
      const adminUsers = await this.getAdminUsers();

      for (const admin of adminUsers) {
        await this.createNotification({
          userId: admin.id,
          title: '⚠️ Seller Declined Price Change',
          message: `Seller has declined the proposed price change for "${prodTitle}". The live price remains UGX ${Number(request.current_price).toLocaleString()}.`,
          type: 'price_rejected'
        });
      }

      return {
        success: true,
        decision: 'Rejected',
        message: 'Price proposal declined. The original price remains unchanged.'
      };
    }
  },

  async cancelPendingPriceRequestsForProduct(productId, reason = '') {
    const pId = parseInt(productId, 10);

    if (!pId) {
      return false;
    }

    if (isConnectedToPostgres && pool) {
      try {
        await pool.query(`
          UPDATE price_change_requests
          SET
            status = 'Cancelled',
            resolved_at = NOW()
          WHERE product_id = $1
            AND status = 'Pending'
        `, [pId]);

        return true;
      } catch (err) {
        console.warn(
          'Could not cancel pending price requests:',
          err.message
        );

        return false;
      }
    }

    let changed = false;

    memPriceChangeRequests.forEach(req => {
      if (
        req.product_id === pId &&
        req.status === 'Pending'
      ) {
        req.status = 'Cancelled';
        req.resolved_at = new Date();
        req.cancel_reason = reason;
        changed = true;
      }
    });

    return changed;
  },

  async findUserById(id) {
    return this.getUserById(id);
  },

  async findUserByEmail(email) {
    return this.getUserByEmail(email);
  },

  async authenticateUser(email, password) {
    const user =
      await this.getUserByEmail(email);

    if (!user) {
      return null;
    }

    const valid =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!valid) {
      return null;
    }

    return user;
  },

  async updateUser(id, data) {
    const userId =
      parseInt(id, 10);

    if (!userId) {
      return null;
    }

    const existing =
      await this.getUserById(userId);

    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...data,
      id: userId
    };

    try {
      const res =
        await executePgQuery(`
          UPDATE users
          SET
            name = $1,
            email = $2,
            role = $3,
            is_admin = $4,
            phone = $5,
            whatsapp_number = $6,
            has_whatsapp = $7
          WHERE id = $8
          RETURNING *
        `, [
          updated.name,
          updated.email,
          updated.role || 'customer',
          updated.is_admin ? 1 : 0,
          updated.phone || '',
          updated.whatsapp_number || '',
          updated.has_whatsapp !== false,
          userId
        ]);

      if (res.rows.length > 0) {
        const result =
          res.rows[0];

        const index =
          memUsers.findIndex(
            u => u.id === userId
          );

        if (index >= 0) {
          memUsers[index] = result;
        }

        return result;
      }

    } catch (err) {
      console.warn(
        'Database user update failed:',
        err.message
      );
    }

    const index =
      memUsers.findIndex(
        u => u.id === userId
      );

    if (index >= 0) {
      memUsers[index] = updated;
    } else {
      memUsers.push(updated);
    }

    return updated;
  },

  async updateUserPassword(id, newPassword) {
    const userId =
      parseInt(id, 10);

    if (!userId || !newPassword) {
      return false;
    }

    const passwordHash =
      await bcrypt.hash(
        newPassword,
        10
      );

    try {
      await executePgQuery(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, userId]
      );

      const user =
        memUsers.find(
          u => u.id === userId
        );

      if (user) {
        user.password_hash =
          passwordHash;
      }

      return true;

    } catch (err) {
      const user =
        memUsers.find(
          u => u.id === userId
        );

      if (user) {
        user.password_hash =
          passwordHash;

        return true;
      }

      return false;
    }
  },

  async deleteUser(id) {
    const userId =
      parseInt(id, 10);

    if (!userId) {
      return false;
    }

    // Never delete the primary admin account
    if (userId === 1) {
      return false;
    }

    try {
      await executePgQuery(
        'DELETE FROM users WHERE id = $1',
        [userId]
      );

      memUsers =
        memUsers.filter(
          u => u.id !== userId
        );

      return true;

    } catch (err) {
      const before =
        memUsers.length;

      memUsers =
        memUsers.filter(
          u => u.id !== userId
        );

      return (
        memUsers.length <
        before
      );
    }
  },

  async getAdminUsers() {
    try {
      const res =
        await executePgQuery(`
          SELECT *
          FROM users
          WHERE is_admin = 1
             OR role = 'admin'
          ORDER BY id ASC
        `);

      if (res.rows.length > 0) {
        return res.rows;
      }

      return memUsers.filter(
        u =>
          u.is_admin === 1 ||
          u.role === 'admin'
      );

    } catch (err) {
      return memUsers.filter(
        u =>
          u.is_admin === 1 ||
          u.role === 'admin'
      );
    }
  },

  async getSellerUsers() {
    try {
      const res =
        await executePgQuery(`
          SELECT *
          FROM users
          WHERE is_admin = 0
            AND (
              role = 'seller'
              OR role = 'customer'
              OR role IS NULL
            )
          ORDER BY id DESC
        `);

      return res.rows;

    } catch (err) {
      return memUsers.filter(
        u =>
          !u.is_admin &&
          u.id !== 1
      );
    }
  },

  async createNotification({
    userId,
    title,
    message,
    type = 'system'
  }) {
    const uId =
      parseInt(userId, 10);

    if (!uId) {
      return null;
    }

    try {
      const res =
        await executePgQuery(`
          INSERT INTO notifications (
            user_id,
            title,
            message,
            type,
            is_read,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            0,
            CURRENT_TIMESTAMP
          )
          RETURNING *
        `, [
          uId,
          title,
          message,
          type
        ]);

      const notification =
        res.rows[0];

      memNotifications.unshift(
        notification
      );

      return notification;

    } catch (err) {
      const notification = {
        id: memNextNotifId++,
        user_id: uId,
        title,
        message,
        type,
        is_read: 0,
        created_at: new Date()
      };

      memNotifications.unshift(
        notification
      );

      return notification;
    }
  },

  async getNotifications(userId) {
    const uId =
      parseInt(userId, 10);

    if (!uId) {
      return [];
    }

    try {
      const res =
        await executePgQuery(`
          SELECT *
          FROM notifications
          WHERE user_id = $1
          ORDER BY id DESC
        `, [uId]);

      return res.rows;

    } catch (err) {
      return memNotifications
        .filter(
          n => n.user_id === uId
        )
        .sort(
          (a, b) =>
            b.id - a.id
        );
    }
  },

  async markNotificationRead(id, userId) {
    const nId =
      parseInt(id, 10);

    const uId =
      parseInt(userId, 10);

    if (!nId || !uId) {
      return false;
    }

    try {
      await executePgQuery(`
        UPDATE notifications
        SET is_read = 1
        WHERE id = $1
          AND user_id = $2
      `, [
        nId,
        uId
      ]);

      const notification =
        memNotifications.find(
          n =>
            n.id === nId &&
            n.user_id === uId
        );

      if (notification) {
        notification.is_read = 1;
      }

      return true;

    } catch (err) {
      const notification =
        memNotifications.find(
          n =>
            n.id === nId &&
            n.user_id === uId
        );

      if (notification) {
        notification.is_read = 1;
        return true;
      }

      return false;
    }
  },

  async markAllNotificationsRead(userId) {
    const uId =
      parseInt(userId, 10);

    if (!uId) {
      return false;
    }

    try {
      await executePgQuery(`
        UPDATE notifications
        SET is_read = 1
        WHERE user_id = $1
      `, [uId]);

      memNotifications.forEach(
        n => {
          if (n.user_id === uId) {
            n.is_read = 1;
          }
        }
      );

      return true;

    } catch (err) {
      memNotifications.forEach(
        n => {
          if (n.user_id === uId) {
            n.is_read = 1;
          }
        }
      );

      return true;
    }
  },
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
    const otpCode = generateOtp();
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
        ownerWhatsApp: '+256 763 480495'
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

module.exports = db;
module.exports.db = db;
module.exports.initDatabase = initDatabase;
