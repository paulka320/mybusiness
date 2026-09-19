const crypto = require('crypto');

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

async function withTransaction(pool, work) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('A PostgreSQL pool is required for transactions.');
  }
  if (typeof work !== 'function') {
    throw new TypeError('Transaction work must be a function.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function reserveStock(client, productId, quantity) {
  const id = Number.parseInt(productId, 10);
  const amount = Number.parseInt(quantity, 10);

  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(amount) || amount < 1) {
    throw new Error('Invalid product or quantity.');
  }

  const result = await client.query(
    `UPDATE products
        SET quantity = quantity - $1,
            approved = CASE WHEN quantity - $1 <= 0 THEN 0 ELSE approved END
      WHERE id = $2 AND quantity >= $1
      RETURNING id, quantity`,
    [amount, id]
  );

  if (result.rowCount !== 1) {
    const error = new Error('Insufficient stock.');
    error.code = 'INSUFFICIENT_STOCK';
    throw error;
  }

  return result.rows[0];
}

module.exports = { generateOtp, reserveStock, withTransaction };
