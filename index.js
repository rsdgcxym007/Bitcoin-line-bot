const axios = require("axios");
const { Pool } = require("pg");
require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());
const cron = require("node-cron");

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
  "bitcoin",
  "dogecoin",
  "algorand",
];
cron.schedule("59 23 * * *", async () => {
  // รันเวลา 23:59 ทุกวัน
  try {
    // ดึงข้อมูลราคาสูงสุดและต่ำสุด
    const highLowQuery = `
      SELECT coin_name,
             MAX(current_price) AS high_price,
             MIN(current_price) AS low_price
      FROM coin_prices
      GROUP BY coin_name;
    `;
    const highLowData = await pool.query(highLowQuery);

    for (const row of highLowData.rows) {
      const { coin_name, high_price, low_price } = row;

      // บันทึกข้อมูลใน coin_price_history
      await pool.query(
        `INSERT INTO coin_price_history (coin_name, date, open_price, close_price, high_price, low_price)
         VALUES ($1, CURRENT_DATE - INTERVAL '1 day', $2, $3, $4, $5)
         ON CONFLICT (coin_name, date) DO NOTHING;`,
        [coin_name, high_price, low_price, high_price, low_price]
      );
    }
    console.log("Daily data moved to coin_price_history");
  } catch (error) {
    console.error("Error updating daily history:", error.message);
  }
});
cron.schedule("* * * * *", async () => {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(
        ","
      )}&vs_currencies=thb`
    );

    for (const coin of coins) {
      const currentPrice = response.data[coin].thb;

      // ดึงข้อมูลราคาเดิมจากฐานข้อมูล
      const { rows } = await pool.query(
        "SELECT * FROM coin_prices WHERE coin_name = $1",
        [coin]
      );

      if (rows.length > 0) {
        const previousData = rows[0];

        // ตรวจสอบและอัปเดตราคาในช่วงเวลาต่าง ๆ
        const now = new Date();

        const price_15m =
          previousData.updated_15m <= new Date(Date.now() - 15 * 60 * 1000)
            ? currentPrice
            : previousData.price_15m;

        const price_30m =
          previousData.updated_30m <= new Date(Date.now() - 30 * 60 * 1000)
            ? currentPrice
            : previousData.price_30m;

        const price_1hr =
          previousData.updated_1hr <= new Date(Date.now() - 60 * 60 * 1000)
            ? currentPrice
            : previousData.price_1hr;

        const price_2hr =
          previousData.updated_2hr <= new Date(Date.now() - 2 * 60 * 60 * 1000)
            ? currentPrice
            : previousData.price_2hr;

        const price_4hr =
          previousData.updated_4hr <= new Date(Date.now() - 4 * 60 * 60 * 1000)
            ? currentPrice
            : previousData.price_4hr;

        const price_1day =
          previousData.updated_1day <=
          new Date(Date.now() - 24 * 60 * 60 * 1000)
            ? currentPrice
            : previousData.price_1day;

        // คำนวณความแตกต่างสำหรับแต่ละช่วงเวลา
        const changes = {
          diff_15m: {
            amount: currentPrice - price_15m,
            percentage: ((currentPrice - price_15m) / price_15m) * 100,
          },
          diff_30m: {
            amount: currentPrice - price_30m,
            percentage: ((currentPrice - price_30m) / price_30m) * 100,
          },
          diff_1hr: {
            amount: currentPrice - price_1hr,
            percentage: ((currentPrice - price_1hr) / price_1hr) * 100,
          },
          diff_2hr: {
            amount: currentPrice - price_2hr,
            percentage: ((currentPrice - price_2hr) / price_2hr) * 100,
          },
          diff_4hr: {
            amount: currentPrice - price_4hr,
            percentage: ((currentPrice - price_4hr) / price_4hr) * 100,
          },
          diff_1day: {
            amount: currentPrice - price_1day,
            percentage: ((currentPrice - price_1day) / price_1day) * 100,
          },
        };

        // console.log(`เหรียญ ${coin}:`, changes);

        // อัปเดตราคาในฐานข้อมูล
        await pool.query(
          `UPDATE coin_prices
           SET current_price = $1,
               price_15m = $2,
               price_30m = $3,
               price_1hr = $4,
               price_2hr = $5,
               price_4hr = $6,
               price_1day = $7,
               updated_15m = CASE 
                   WHEN updated_15m <= NOW() - INTERVAL '15 minutes' THEN NOW()
                   ELSE updated_15m
               END,
               updated_30m = CASE 
                   WHEN updated_30m <= NOW() - INTERVAL '30 minutes' THEN NOW()
                   ELSE updated_30m
               END,
               updated_1hr = CASE 
                   WHEN updated_1hr <= NOW() - INTERVAL '1 hour' THEN NOW()
                   ELSE updated_1hr
               END,
               updated_2hr = CASE 
                   WHEN updated_2hr <= NOW() - INTERVAL '2 hours' THEN NOW()
                   ELSE updated_2hr
               END,
               updated_4hr = CASE 
                   WHEN updated_4hr <= NOW() - INTERVAL '4 hours' THEN NOW()
                   ELSE updated_4hr
               END,
               updated_1day = CASE 
                   WHEN updated_1day <= NOW() - INTERVAL '1 day' THEN NOW()
                   ELSE updated_1day
               END,
               updated_at = NOW()
           WHERE coin_name = $8`,
          [
            currentPrice,
            price_15m,
            price_30m,
            price_1hr,
            price_2hr,
            price_4hr,
            price_1day,
            coin,
          ]
        );
      } else {
        // หากยังไม่มีข้อมูลของเหรียญนี้ ให้เพิ่มข้อมูลเข้าไปใหม่
        await pool.query(
          `INSERT INTO coin_prices (coin_name, current_price, price_15m, price_30m, price_1hr, price_2hr, price_4hr, price_1day, updated_15m, updated_30m, updated_1hr, updated_2hr, updated_4hr, updated_1day, updated_at)
           VALUES ($1, $2, $2, $2, $2, $2, $2, $2, NOW(), NOW(), NOW(), NOW(), NOW(), NOW(), NOW())`,
          [coin, currentPrice]
        );
      }
    }
  } catch (error) {
    console.error("Error fetching or updating prices:", error.message);
  }
});

// ดึงราคาจาก CoinGecko API
const fetchCryptoPricesFromCoinGecko = async () => {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=stellar,cardano,ripple,act-i-the-ai-prophecy,the-sandbox,bitcoin,dogecoin&vs_currencies=thb`
    );
    return Object.fromEntries(
      Object.entries(response.data).map(([coin, data]) => [coin, data.thb])
    );
  } catch (error) {
    console.error("Error fetching prices from CoinGecko:", error.message);
    return {};
  }
};

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
        // console.log(`Saved initial price for ${coin}: ${price}`);
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
async function sendLineMessage(userId, messages) {
  try {
    // รวมข้อความหาก messages เป็น Array
    const messageText = Array.isArray(messages)
      ? messages.join("\n") // เชื่อมข้อความด้วย "\n" สำหรับแยกบรรทัด
      : messages; // ใช้ข้อความตรงๆ หากไม่ใช่ Array

    // ส่งข้อความ
    const result = await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [{ type: "text", text: messageText }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        },
      }
    );
    console.log("result", result);

    // console.log(`Message sent to ${userId}:`, messageText);
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

const formatDetailedMessage = (
  coinName,
  currentPrice,
  initialPrice,
  percentageChange,
  dataPriceReport
) => {
  const detailedReport = dataPriceReport.find((report) =>
    report.startsWith(`เหรียญ ${coinName.toUpperCase()}`)
  );

  return `
⚠️ **แจ้งเตือนราคาเหรียญ ${coinName.toUpperCase()}**
- ราคาเริ่มต้น: ${initialPrice.toLocaleString()} THB
- ราคาปัจจุบัน: ${currentPrice.toLocaleString()} THB
- เปลี่ยนแปลง: **${percentageChange.toFixed(2)}%**

**รายงานข้อมูลเพิ่มเติม:**
${detailedReport?.replace(/\n/g, "\n  ")}\n
  `;
};

const getData = async () => {
  try {
    const result = await pool.query("SELECT * FROM coin_prices");
    const processedData = processCoinData(result.rows);

    // สร้างข้อความรายงาน
    const dataPriceReport = processedData.map((data) => data.message);

    // ดึงราคาตั้งต้น
    const initialPricesResult = await pool.query(
      "SELECT coin_name, initial_price FROM crypto_prices"
    );

    // แปลงข้อมูลเป็น Object
    const initialPrices = Object.fromEntries(
      initialPricesResult.rows.map((row) => [
        row.coin_name,
        parseFloat(row.initial_price),
      ])
    );

    // ดึงราคาปัจจุบันจาก CoinGecko
    const prices = await fetchCryptoPricesFromCoinGecko();

    // เก็บข้อความแจ้งเตือนทั้งหมดใน Array
    const messages = [];

    for (const [coin, currentPrice] of Object.entries(prices)) {
      const initialPrice = initialPrices[coin];
      if (initialPrice == null) {
        console.warn(`Skipping update for ${coin}: initialPrice is null`);
        continue;
      }

      const percentageChange =
        ((currentPrice - initialPrice) / initialPrice) * 100;

      // อัปเดตราคาปัจจุบันและการเปลี่ยนแปลง
      await pool.query(
        `UPDATE crypto_prices
         SET current_price = $1,
             percentage_change = $2,
             checked_at = NOW()
         WHERE coin_name = $3`,
        [currentPrice, percentageChange, coin]
      );

      // สร้างข้อความแจ้งเตือนสำหรับเหรียญที่เปลี่ยนแปลงเกิน 5%
      if (Math.abs(percentageChange) >= 5) {
        const message = formatDetailedMessage(
          coin,
          currentPrice,
          initialPrice,
          percentageChange,
          dataPriceReport
        );
        messages.push(message); // เพิ่มข้อความใน Array
      }
    }

    // รวมข้อความทั้งหมดใน Array เข้าด้วยกัน
    if (messages.length > 0) {
      const combinedMessage = messages.join("\n\n---\n\n");

      // ส่งข้อความรวมถึงผู้ใช้ทุกคน
      const userIds = await getAllUserIdsFromDB();
      for (const userId of userIds) {
        try {
          await sendLineMessage(userId, combinedMessage);
        } catch (error) {
          console.error(
            `Error sending message to user ${userId}:`,
            error.message
          );
        }
      }
    }
  } catch (error) {
    console.error("getData Error:", error.message);
  }
};

// const formatMessage = (coin) => {
//   if (!coin.coin_name) {
//     // console.warn("Skipping data without coin_name:", coin);
//     return "ข้อมูลไม่สมบูรณ์";
//   }

//   return `
// เหรียญ ${coin.coin_name?.toUpperCase()}:
// ราคาปัจจุบัน: ${coin.current_price?.toFixed(2)}
// - ราคาช่วง 15 นาที: ${coin.change_15m?.toFixed(2)}%
// - ราคาช่วง 30 นาที: ${coin.change_30m?.toFixed(2)}%
// - ราคาช่วง 1 ชั่วโมง: ${coin.change_1hr?.toFixed(2)}%
// - ราคาช่วง 2 ชั่วโมง: ${coin.change_2hr?.toFixed(2)}%
// - ราคาช่วง 4 ชั่วโมง: ${coin.change_4hr?.toFixed(2)}%
// - ราคาช่วง 1 วัน: ${coin.change_1day?.toFixed(2)}%
// `.trim();
// };

const processCoinData = (coinData) => {
  return coinData
    .map((coin) => {
      // ตรวจสอบข้อมูลก่อนคำนวณ
      if (!coin.coin_name || !coin.current_price) {
        console.warn(`ข้อมูลไม่สมบูรณ์สำหรับเหรียญ:`, coin);
        return null;
      }

      const processedCoin = {
        coin_name: coin.coin_name,
        current_price: parseFloat(coin.current_price),
        change_15m: calculatePercentageChangeWithDetails(
          parseFloat(coin.price_15m || coin.current_price), // fallback to current_price if null
          parseFloat(coin.current_price)
        ),
        change_30m: calculatePercentageChangeWithDetails(
          parseFloat(coin.price_30m || coin.current_price),
          parseFloat(coin.current_price)
        ),
        change_1hr: calculatePercentageChangeWithDetails(
          parseFloat(coin.price_1hr || coin.current_price),
          parseFloat(coin.current_price)
        ),
        change_2hr: calculatePercentageChangeWithDetails(
          parseFloat(coin.price_2hr || coin.current_price),
          parseFloat(coin.current_price)
        ),
        change_4hr: calculatePercentageChangeWithDetails(
          parseFloat(coin.price_4hr || coin.current_price),
          parseFloat(coin.current_price)
        ),
        change_1day: calculatePercentageChangeWithDetails(
          parseFloat(coin.price_1day || coin.current_price),
          parseFloat(coin.current_price)
        ),
      };

      return {
        processedCoin,
        message: formatMessage(processedCoin),
      };
    })
    .filter(Boolean); // กรองข้อมูลที่ null ออก
};

function calculatePercentageChangeWithDetails(oldPrice, newPrice) {
  if (!oldPrice || oldPrice === 0) {
    return {
      oldPrice: 0,
      change: 0,
      formatted: `0.00 (0%)`,
    };
  }

  const change = ((newPrice - oldPrice) / oldPrice) * 100;
  const sign = change > 0 ? "+" : "";
  return {
    oldPrice,
    change,
    formatted: `${oldPrice.toFixed(2)} (${sign}${change.toFixed(2)}%)`,
  };
}

function formatMessage(coin) {
  return `
เหรียญ ${coin.coin_name.toUpperCase()}:
ราคาปัจจุบัน: ${coin.current_price.toFixed(2)} 
- ราคาช่วง 15 นาที: ${coin.change_15m.formatted} 
- ราคาช่วง 30 นาที: ${coin.change_30m.formatted} 
- ราคาช่วง 1 ชั่วโมง: ${coin.change_1hr.formatted} 
- ราคาช่วง 2 ชั่วโมง: ${coin.change_2hr.formatted} 
- ราคาช่วง 4 ชั่วโมง: ${coin.change_4hr.formatted} 
- ราคาช่วง 1 วัน: ${coin.change_1day.formatted}
`.trim();
}

const calculatePercentageChange = (oldPrice, newPrice) => {
  if (oldPrice == 0 || oldPrice == null) return 0; // ป้องกันการหารด้วยศูนย์
  return ((newPrice - oldPrice) / oldPrice) * 100;
};

app.get("/coingecko", async (req, res) => {
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
  console.log("prices", prices);

  return prices;
});
app.get("/daily-report", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT coin_name, date, open_price, close_price, high_price, low_price
      FROM coin_price_history
      ORDER BY date DESC;
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching daily report:", error.message);
    res.status(500).send("Error generating daily report");
  }
});
app.get("/price-report", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM coin_prices");

    const report = rows.map((coin) => ({
      coin_name: coin.coin_name,
      current_price: coin.current_price,
      change_15m: calculatePercentageChange(coin.price_15m, coin.current_price),
      change_30m: calculatePercentageChange(coin.price_30m, coin.current_price),
      change_1hr: calculatePercentageChange(coin.price_1hr, coin.current_price),
      change_2hr: calculatePercentageChange(coin.price_2hr, coin.current_price),
      change_4hr: calculatePercentageChange(coin.price_4hr, coin.current_price),
      change_1day: calculatePercentageChange(
        coin.price_1day,
        coin.current_price
      ),
    }));

    res.json(report);
    console.log("report", report);
  } catch (error) {
    console.error("Error fetching price report:", error.message);
    res.status(500).send("Error generating report");
  }
});

app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  console.log("Webhook received:", events);
  res.status(200).send("OK");
  if (events && events.length > 0) {
    const userId = events[0]?.source?.userId;
    console.log("User ID ที่รับได้:", userId);

    const result = await saveUserIdToDB(userId);
    console.log(result.message);
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
setInterval(getData, 60 * 60 * 1000);
