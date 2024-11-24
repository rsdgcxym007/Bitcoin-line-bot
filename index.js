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
const coins = ["XLM", "ADA", "XRP", "ACT", "SAND"];

// Fetch cryptocurrency prices from Binance
async function fetchCryptoPricesFromBinance() {
  const coinPairs = coins.map((coin) => `${coin}USDT`); // Binance uses USDT pairs
  const prices = {};

  try {
    for (const pair of coinPairs) {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`
      );
      const usdtPrice = parseFloat(response.data.price); // Price in USDT
      const coin = pair.replace("USDT", ""); // Remove USDT from coin name
      prices[coin] = usdtPrice;
    }
  } catch (error) {
    console.error("Error fetching prices from Binance API:", error.message);
  }

  return prices;
}

// Convert USDT prices to THB
async function convertToTHB(pricesInUSDT) {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=thb"
    );
    const usdtToThbRate = response.data.tether.thb; // Conversion rate for 1 USDT to THB
    const pricesInTHB = {};

    for (const [coin, usdtPrice] of Object.entries(pricesInUSDT)) {
      pricesInTHB[coin] = usdtPrice * usdtToThbRate;
    }

    return pricesInTHB;
  } catch (error) {
    console.error("Error converting prices to THB:", error.message);
    return null;
  }
}

// Save or update cryptocurrency prices in the database
async function saveCryptoPricesToDB(prices) {
  const now = new Date();
  for (const [coin, price] of Object.entries(prices)) {
    try {
      // ตรวจสอบข้อมูลในตาราง
      const result = await pool.query(
        `SELECT current_price FROM crypto_prices WHERE coin_name = $1`,
        [coin]
      );

      if (result.rows.length > 0) {
        // คำนวณการเปลี่ยนแปลง (%)
        const previousPrice = parseFloat(result.rows[0].current_price);
        const percentageChange =
          ((price - previousPrice) / previousPrice) * 100;

        // อัปเดตข้อมูลในฐานข้อมูล
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
          `Updated price for ${coin}: ${price} THB (Change: ${percentageChange.toFixed(
            2
          )}%)`
        );
      } else {
        // เพิ่มข้อมูลใหม่ในกรณีที่เหรียญยังไม่มีในฐานข้อมูล
        await pool.query(
          `INSERT INTO crypto_prices (coin_name, current_price, previous_price, percentage_change, updated_at)
           VALUES ($1, $2, NULL, NULL, $3)`,
          [coin, price, now]
        );

        console.log(`Inserted new coin ${coin} with price ${price} THB`);
      }
    } catch (error) {
      console.error(`Error saving price for ${coin}:`, error.message);
    }
  }
}

// Check for significant price changes and notify users
async function checkPriceChanges(prices) {
  const now = new Date();

  for (const [coin, currentPrice] of Object.entries(prices)) {
    try {
      const result = await pool.query(
        `SELECT current_price, updated_at FROM crypto_prices WHERE coin_name = $1`,
        [coin]
      );

      if (result.rows.length > 0) {
        const { current_price: previousPrice, updated_at: lastUpdated } =
          result.rows[0];
        const lastUpdatedTime = new Date(lastUpdated);

        // ตรวจสอบว่าเวลาห่าง 5 นาทีหรือไม่
        const timeDiffMinutes = (now - lastUpdatedTime) / (1000 * 60); // แปลงเป็นนาที
        if (timeDiffMinutes >= 0.1) {
          const percentageChange =
            ((currentPrice - previousPrice) / previousPrice) * 100;

          if (Math.abs(percentageChange) >= 0.1) {
            const message = `⚠️ ราคาเหรียญ ${coin} เปลี่ยนแปลง ${percentageChange.toFixed(
              2
            )}%\nราคาก่อนหน้า: ${previousPrice.toLocaleString()} THB\nราคาปัจจุบัน: ${currentPrice.toLocaleString()} THB`;

            // ดึง User IDs และส่งข้อความ
            const userIds = await getAllUserIdsFromDB();
            for (const userId of userIds) {
              await sendLineMessage(userId, message);
            }
          }

          // อัปเดตราคาในฐานข้อมูล
          await pool.query(
            `UPDATE crypto_prices SET previous_price = current_price, current_price = $1, updated_at = $2 WHERE coin_name = $3`,
            [currentPrice, now, coin]
          );
        } else {
          console.log(`ยังไม่ครบ 5 นาทีสำหรับเหรียญ ${coin}`);
        }
      }
    } catch (error) {
      console.error(`Error checking price changes for ${coin}:`, error.message);
    }
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
  const pricesInUSDT = await fetchCryptoPricesFromBinance();
  const pricesInTHB = await convertToTHB(pricesInUSDT);

  if (pricesInTHB) {
    await saveCryptoPricesToDB(pricesInTHB);
    await checkPriceChanges(pricesInTHB);
  }
}

// Run the price monitoring process every 3 minutes
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
