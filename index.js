const axios = require("axios");
const { Pool } = require("pg");
require("dotenv").config();
const express = require("express");

// PostgreSQL connection setup
const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

// Cryptocurrencies to monitor
const coins = [
  "stellar",
  "cardano",
  "ripple",
  "act-i-the-ai-prophecy",
  "the-sandbox",
]; // ใช้ชื่อเหรียญในรูปแบบที่ CoinGecko รองรับ

// Fetch cryptocurrency prices in THB from CoinGecko
async function fetchCryptoPricesFromCoinGecko() {
  const prices = {};

  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(
        ","
      )}&vs_currencies=thb`
    );

    for (const coin of coins) {
      prices[coin] = response.data[coin].thb; // ราคาในหน่วย THB
    }
  } catch (error) {
    console.error("Error fetching prices from CoinGecko API:", error.message);
  }

  return prices;
}
async function saveCryptoPriceHistory(coin, price) {
  try {
    await pool.query(
      `INSERT INTO crypto_price_history (coin_name, price, checked_at)
       VALUES ($1, $2, NOW())`,
      [coin, price]
    );
    console.log(`Saved price history for ${coin}: ${price}`);
  } catch (error) {
    console.error(`Error saving price history for ${coin}:`, error.message);
  }
}

// บันทึกประวัติราคาสำหรับทุกเหรียญ
async function saveAllPriceHistories(prices) {
  for (const [coin, price] of Object.entries(prices)) {
    await saveCryptoPriceHistory(coin, price);
  }
}
async function getPriceBefore5Minutes(coin) {
  try {
    const result = await pool.query(
      `SELECT price FROM crypto_price_history
       WHERE coin_name = $1 AND checked_at <= NOW() - INTERVAL '5 minutes'
       ORDER BY checked_at DESC LIMIT 1`,
      [coin]
    );

    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].price);
    } else {
      return null; // ไม่มีข้อมูลก่อนหน้า 5 นาที
    }
  } catch (error) {
    console.error(
      `Error fetching price before 5 minutes for ${coin}:`,
      error.message
    );
    return null;
  }
}
// Save or update cryptocurrency prices in the database
async function saveCryptoPricesToDB(prices) {
  const now = new Date();
  for (const [coin, price] of Object.entries(prices)) {
    try {
      const result = await pool.query(
        `SELECT current_price FROM crypto_prices WHERE coin_name = $1`,
        [coin]
      );

      if (result.rows.length > 0) {
        const previousPrice = parseFloat(result.rows[0].current_price);
        const percentageChange =
          previousPrice && previousPrice !== 0
            ? ((price - previousPrice) / previousPrice) * 100
            : 0;

        await pool.query(
          `UPDATE crypto_prices
           SET previous_price = current_price,
               current_price = $1,
               percentage_change = $2,
               updated_at = $3
           WHERE coin_name = $4`,
          [price, percentageChange, now, coin]
        );
        console.log(
          `Updated ${coin}: Current = ${price}, Change = ${percentageChange.toFixed(
            2
          )}%`
        );
      } else {
        await pool.query(
          `INSERT INTO crypto_prices (coin_name, current_price, previous_price, percentage_change, updated_at)
           VALUES ($1, $2, NULL, NULL, $3)`,
          [coin, price, now]
        );
        console.log(`Inserted new coin ${coin} with Current Price = ${price}`);
      }
    } catch (error) {
      console.error(`Error saving price for ${coin}:`, error.message);
    }
  }
}

async function checkPriceChanges() {
  try {
    const result = await pool.query(
      `SELECT coin_name, percentage_change, current_price, previous_price FROM crypto_prices`
    );

    for (const row of result.rows) {
      const {
        coin_name: coin,
        percentage_change,
        current_price,
        previous_price,
      } = row;

      if (Math.abs(percentage_change) >= 5) {
        const message = `⚠️ ราคาเหรียญ ${coin} เปลี่ยนแปลง ${percentage_change.toFixed(
          2
        )}%\nราคาก่อนหน้า: ${
          previous_price?.toLocaleString() || "N/A"
        } THB\nราคาปัจจุบัน: ${current_price.toLocaleString()} THB`;

        const userIds = await getAllUserIdsFromDB();
        for (const userId of userIds) {
          await sendLineMessage(userId, message);
        }
      }
    }
  } catch (error) {
    console.error("Error checking price changes:", error.message);
  }
}

// Retrieve all user IDs from the database
async function getAllUserIdsFromDB() {
  try {
    const result = await pool.query("SELECT user_id FROM test_table");
    return result.rows.map((row) => row.user_id);
  } catch (error) {
    console.error("Error fetching user IDs from database:", error.message);
    return [];
  }
}

// Send a LINE message to a user
async function sendLineMessage(userId, message) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [{ type: "text", text: message }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        },
      }
    );
    console.log(`Message sent to ${userId}:`, message);
  } catch (error) {
    console.error(
      "Error sending LINE message:",
      error.response?.data || error.message
    );
  }
}

// Monitor and process cryptocurrency prices
async function monitorCryptoPrices() {
  const pricesInTHB = await fetchCryptoPricesFromCoinGecko();

  if (pricesInTHB) {
    await saveCryptoPricesToDB(pricesInTHB);
    await checkPriceChanges(pricesInTHB);
  }
}

setInterval(monitorCryptoPrices, 20000);

// Express server for LINE Webhook
const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  if (events && events.length > 0) {
    const userId = events[0]?.source?.userId;
    try {
      await pool.query(
        "INSERT INTO test_table (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        [userId]
      );
      console.log("Saved User ID:", userId);
    } catch (error) {
      console.error("Error saving User ID:", error.message);
    }
  }

  res.status(200).send("OK");
});

// Start the Express server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
