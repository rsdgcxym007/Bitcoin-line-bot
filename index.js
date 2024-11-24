require("dotenv").config();
const axios = require("axios");
const express = require("express");
const app = express();

app.use(express.json());

// อ่านค่าจาก .env
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

const { Pool } = require("pg");

// ตั้งค่าการเชื่อมต่อ PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL, // ใช้ Public Endpoint
  ssl: {
    rejectUnauthorized: false, // Railway ต้องการ SSL
  },
});

// ฟังก์ชันเชื่อมต่อฐานข้อมูล
async function connectToDatabase() {
  try {
    await pool.connect();
    console.log("เชื่อมต่อฐานข้อมูล PostgreSQL สำเร็จ!");
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล:", error);
  }
}

connectToDatabase();

// ฟังก์ชันดึงราคาบิทคอยน์
async function getBitcoinPrice() {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=thb"
    );
    return response.data.bitcoin.thb; // ราคาบิทคอยน์ในสกุลเงินบาท
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการดึงราคาบิทคอยน์:", error);
    return null;
  }
}

// ฟังก์ชันส่งข้อความไปยัง LINE
async function sendLineMessage(userId, message) {
  console.log("กำลังส่งข้อความไปยัง User ID:", userId);
  console.log("ข้อความที่ส่ง:", message);

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
          Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
        },
      }
    );
    console.log("ส่งข้อความสำเร็จ");
  } catch (error) {
    console.error(
      "เกิดข้อผิดพลาดในการส่งข้อความ:",
      error.response?.data || error.message
    );
  }
}

// ฟังก์ชันดึง User ID ทั้งหมดจากฐานข้อมูล
async function getAllUserIdsFromDB() {
  try {
    const result = await pool.query("SELECT user_id FROM test_table");
    return result.rows.map((row) => row.user_id);
  } catch (error) {
    console.error("เกิดข้อผิดพลาดในการดึง User ID จากฐานข้อมูล:", error);
    return [];
  }
}

// ตั้งเวลาตรวจสอบและแจ้งเตือนทุกๆ 1 นาที
setInterval(async () => {
  console.log("กำลังตรวจสอบราคาบิทคอยน์...");
  const currentPrice = await getBitcoinPrice();

  if (!currentPrice) {
    console.error("ไม่สามารถดึงราคาบิทคอยน์ได้");
    return;
  }

  const message = `ราคาบิทคอยน์ปัจจุบัน: ${currentPrice.toLocaleString()} บาท`;

  // ดึง User ID ทั้งหมดจากฐานข้อมูล
  const userIds = await getAllUserIdsFromDB();

  // ส่งข้อความแจ้งเตือนถึงผู้ใช้ทั้งหมด
  for (const userId of userIds) {
    await sendLineMessage(userId, message);
  }
}, 60 * 1000); // ตรวจสอบทุกๆ 1 นาที

// Endpoint Webhook
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  console.log("Webhook received:", events);

  // ตอบกลับ LINE เพื่อยืนยันว่า Webhook ทำงานได้
  res.status(200).send("OK");

  // ดึง User ID จากข้อความและบันทึกลงฐานข้อมูล
  if (events && events.length > 0) {
    const userId = events[0]?.source?.userId; // ดึง User ID
    console.log("User ID ที่รับได้:", userId);

    try {
      await pool.query(
        "INSERT INTO test_table (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        [userId]
      );
      console.log("บันทึก User ID ลงฐานข้อมูลสำเร็จ:", userId);
    } catch (error) {
      console.error("เกิดข้อผิดพลาดในการบันทึก User ID ลงฐานข้อมูล:", error);
    }
  }
});

// เปิดเซิร์ฟเวอร์
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
