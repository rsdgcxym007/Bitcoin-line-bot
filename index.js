const axios = require("axios");
const { Pool } = require("pg");
require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

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
      // ตรวจสอบว่ามีข้อมูลในตารางอยู่แล้วหรือไม่
      const result = await pool.query(
        `SELECT initial_price FROM crypto_prices WHERE coin_name = $1`,
        [coin]
      );
      // ถ้ายังไม่มีข้อมูล ให้บันทึกใหม่
      if (result.rows.length === 0) {
        await pool.query(
          `INSERT INTO crypto_prices (coin_name, initial_price, current_price, checked_at)
           VALUES ($1, $2, $2, NOW())`,
          [coin, price]
        );
        console.log(`Saved initial price for ${coin}: ${price}`);
      } else {
        console.log(`Initial price for ${coin} already exists. Skipping.`);
      }
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
      await saveInitialPrices(prices); // บันทึกราคาเริ่มต้นครั้งแรก
      await checkPriceChanges(prices); // ตรวจสอบราคาปัจจุบัน
    }
  } catch (error) {
    console.error("Error monitoring crypto prices:", error.message);
  }
}
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  console.log("Webhook received:", events);

  // ตอบกลับ LINE เพื่อยืนยันว่า Webhook ทำงานได้
  res.status(200).send("OK");

  // ดึง User ID จากข้อความและบันทึกลงฐานข้อมูล
  if (events && events.length > 0) {
    const userId = events[0]?.source?.userId; // ดึง User ID
    console.log("User ID ที่รับได้:", userId);

    const result = await saveUserIdToDB(userId);
    console.log(result.message); // ดูข้อความจากฟังก์ชัน
  }
});
async function saveUserIdToDB(userId) {
  console.log("กำลังบันทึก User ID ลงฐานข้อมูล:", userId);
  try {
    const result = await pool.query(
      "INSERT INTO test_table (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING id",
      [userId]
    );

    if (result.rowCount > 0) {
      console.log("บันทึก User ID ลงฐานข้อมูลสำเร็จ:", userId);
      return { success: true, message: "User ID saved successfully" };
    } else {
      console.log("User ID มีอยู่ในฐานข้อมูลแล้ว:", userId);
      return { success: false, message: "User ID already exists" };
    }
  } catch (error) {
    console.error(
      "เกิดข้อผิดพลาดในการบันทึก User ID ลงฐานข้อมูล:",
      error.message
    );
    return { success: false, error: error.message };
  }
}
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// เรียกใช้ฟังก์ชันทุก 5 นาที
setInterval(monitorCryptoPrices, 30 * 60 * 1000);
