const axios = require("axios");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

// รายชื่อเหรียญที่ต้องการติดตาม
const coins = [
  "stellar",
  "cardano",
  "ripple",
  "act-i-the-ai-prophecy",
  "the-sandbox",
];

// ดึงราคาจาก CoinGecko API
async function fetchCryptoPricesFromCoinGecko() {
  const prices = {};
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(
        ","
      )}&vs_currencies=thb`
    );
    for (const coin of coins) {
      prices[coin] = response.data[coin].thb;
    }
  } catch (error) {
    console.error("Error fetching prices from CoinGecko API:", error.message);
  }
  return prices;
}

// บันทึกราคาเริ่มต้นลงในฐานข้อมูล
async function saveInitialPrices(prices) {
  for (const [coin, price] of Object.entries(prices)) {
    try {
      await pool.query(
        `INSERT INTO crypto_prices (coin_name, initial_price, current_price, checked_at)
         VALUES ($1, $2, $2, NOW())
         ON CONFLICT (coin_name) DO NOTHING`,
        [coin, price]
      );
      console.log(`Saved initial price for ${coin}: ${price}`);
    } catch (error) {
      console.error(`Error saving initial price for ${coin}:`, error.message);
    }
  }
}

// ตรวจสอบราคาปัจจุบันและเปรียบเทียบกับราคาเริ่มต้น
async function checkPriceChanges(prices) {
  for (const [coin, currentPrice] of Object.entries(prices)) {
    try {
      const result = await pool.query(
        `SELECT initial_price FROM crypto_prices WHERE coin_name = $1`,
        [coin]
      );

      if (result.rows.length > 0) {
        const initialPrice = parseFloat(result.rows[0].initial_price);
        const percentageChange =
          ((currentPrice - initialPrice) / initialPrice) * 100;

        console.log(
          `Coin: ${coin}, Initial Price: ${initialPrice}, Current Price: ${currentPrice}, Change: ${percentageChange.toFixed(
            2
          )}%`
        );

        // อัพเดตราคาปัจจุบันและการเปลี่ยนแปลง
        await pool.query(
          `UPDATE crypto_prices
           SET current_price = $1,
               percentage_change = $2,
               checked_at = NOW()
           WHERE coin_name = $3`,
          [currentPrice, percentageChange, coin]
        );

        // ส่งข้อความถ้าการเปลี่ยนแปลงเกิน 5%
        if (Math.abs(percentageChange) >= 5) {
          const message = `⚠️ ราคาเหรียญ ${coin} เปลี่ยนแปลง ${percentageChange.toFixed(
            2
          )}%\nราคาเริ่มต้น: ${initialPrice.toLocaleString()} THB\nราคาปัจจุบัน: ${currentPrice.toLocaleString()} THB`;
          const userIds = await getAllUserIdsFromDB();
          for (const userId of userIds) {
            await sendLineMessage(userId, message);
          }
        }
      }
    } catch (error) {
      console.error(`Error checking price for ${coin}:`, error.message);
    }
  }
}

// ดึง User IDs ทั้งหมดจากฐานข้อมูล
async function getAllUserIdsFromDB() {
  try {
    const result = await pool.query("SELECT user_id FROM test_table");
    return result.rows.map((row) => row.user_id);
  } catch (error) {
    console.error("Error fetching user IDs from database:", error.message);
    return [];
  }
}

// ส่งข้อความผ่าน LINE API
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

// ฟังก์ชันสำหรับ Monitoring
async function monitorCryptoPrices() {
  try {
    const prices = await fetchCryptoPricesFromCoinGecko();
    if (prices) {
      await saveInitialPrices(prices); // บันทึกราคาเริ่มต้น
      await checkPriceChanges(prices); // ตรวจสอบราคาปัจจุบัน
    }
  } catch (error) {
    console.error("Error monitoring crypto prices:", error.message);
  }
}

// เรียกใช้ฟังก์ชันทุก 5 นาที
setInterval(monitorCryptoPrices, 5 * 60 * 1000);
