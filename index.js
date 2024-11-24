const axios = require("axios");
const { Pool } = require("pg");
require("dotenv").config();

// ตั้งค่าการเชื่อมต่อ PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

// เหรียญที่ต้องการติดตาม
const coins = ["XLM", "ADA", "XRP", "ACT", "SAND"];

// ฟังก์ชันดึงข้อมูลจาก Binance
async function fetchCryptoPrices() {
  const prices = {};
  for (const coin of coins) {
    try {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${coin}USDT`
      );
      prices[coin] = parseFloat(response.data.price);
    } catch (error) {
      console.error(`เกิดข้อผิดพลาดในการดึงราคาเหรียญ ${coin}:`, error.message);
    }
  }
  return prices;
}

// ฟังก์ชันบันทึกราคาเหรียญลงฐานข้อมูล
async function saveCryptoPricesToDB(prices) {
  const now = new Date();
  for (const [coin, price] of Object.entries(prices)) {
    try {
      const result = await pool.query(
        `INSERT INTO crypto_prices (coin_name, current_price, last_checked)
         VALUES ($1, $2, $3)
         ON CONFLICT (coin_name)
         DO UPDATE SET current_price = $2, last_checked = $3 RETURNING *`,
        [coin, price, now]
      );
      console.log(`บันทึกข้อมูลราคาเหรียญ ${coin} สำเร็จ:`, result.rows[0]);
    } catch (error) {
      console.error(
        `เกิดข้อผิดพลาดในการบันทึกข้อมูลเหรียญ ${coin}:`,
        error.message
      );
    }
  }
}

// ฟังก์ชันตรวจสอบการเปลี่ยนแปลงของราคา
async function checkPriceChanges(prices) {
  for (const [coin, currentPrice] of Object.entries(prices)) {
    try {
      const result = await pool.query(
        `SELECT current_price FROM crypto_prices WHERE coin_name = $1`,
        [coin]
      );
      if (result.rows.length > 0) {
        const previousPrice = parseFloat(result.rows[0].current_price);
        const percentageChange =
          ((currentPrice - previousPrice) / previousPrice) * 100;

        if (Math.abs(percentageChange) >= 5) {
          const message = `ราคาเหรียญ ${coin} มีการเปลี่ยนแปลง ${percentageChange.toFixed(
            2
          )}%\nราคาก่อนหน้า: ${previousPrice.toLocaleString()} USDT\nราคาปัจจุบัน: ${currentPrice.toLocaleString()} USDT`;

          // ส่งข้อความแจ้งเตือน
          const userIds = await getAllUserIdsFromDB(); // ดึง User IDs จากฐานข้อมูล
          for (const userId of userIds) {
            await sendLineMessage(userId, message);
          }
        }
      }
    } catch (error) {
      console.error(
        `เกิดข้อผิดพลาดในการตรวจสอบราคาเหรียญ ${coin}:`,
        error.message
      );
    }
  }
}

// ฟังก์ชันดึง User ID จากฐานข้อมูล
async function getAllUserIdsFromDB() {
  try {
    const result = await pool.query("SELECT user_id FROM test_table");
    return result.rows.map((row) => row.user_id);
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการดึง User ID จากฐานข้อมูล:", error);
    return [];
  }
}

// ฟังก์ชันส่งข้อความแจ้งเตือนผ่าน LINE
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
    console.log(`ส่งข้อความถึง ${userId} สำเร็จ:`, message);
  } catch (error) {
    console.error(
      "เกิดข้อผิดพลาดในการส่งข้อความ:",
      error.response?.data || error.message
    );
  }
}

// ตั้งเวลาให้ฟังก์ชันทำงานทุกๆ 3 นาที
setInterval(async () => {
  console.log("กำลังตรวจสอบราคาคริปโต...");
  const prices = await fetchCryptoPrices();
  await saveCryptoPricesToDB(prices);
  await checkPriceChanges(prices);
}, 3 * 60 * 1000); // 3 นาที

// เปิดเซิร์ฟเวอร์สำหรับ Webhook
const express = require("express");
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
      console.log("บันทึก User ID สำเร็จ:", userId);
    } catch (error) {
      console.error("เกิดข้อผิดพลาดในการบันทึก User ID:", error.message);
    }
  }

  res.status(200).send("OK");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
