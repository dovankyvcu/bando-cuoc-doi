const express  = require('express');
const path     = require('path');
const fetch    = require('node-fetch');
const fs       = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const SECRET_TOKEN    = process.env.SECRET_TOKEN    || '';

// ================================================================
// LƯU TRỮ ĐƠN HÀNG BẰNG RAM + FILE JSON
// ================================================================
const ORDERS_FILE = '/tmp/orders.json';

// RAM cache – nhanh và không bị mất trong cùng 1 phiên
const ordersCache = {};

function docOrders() {
  // Ưu tiên RAM
  if (Object.keys(ordersCache).length > 0) return ordersCache;
  // Fallback file
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
      Object.assign(ordersCache, data);
      return ordersCache;
    }
  } catch(e) { console.error('Lỗi đọc file orders:', e.message); }
  return ordersCache;
}

function luuOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersCache), 'utf8');
  } catch(e) { console.error('Lỗi lưu file orders:', e.message); }
}

// ================================================================
// API LƯU ĐƠN TẠM
// ================================================================
app.post('/api/luu-don', (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;
  console.log('📥 /api/luu-don nhận:', { ho_ten, orderId });

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  ordersCache[orderId] = {
    ho_ten, ngay_sinh,
    email: email || '',
    sdt:   sdt   || '',
    thoiGian: Date.now()
  };
  luuOrders();

  console.log('📋 Đã lưu đơn tạm:', orderId, ho_ten);
  console.log('📦 Tổng đơn trong cache:', Object.keys(ordersCache).length);
  return res.json({ success: true });
});

// ================================================================
// WEBHOOK SEPAY
// ================================================================
app.post('/webhook/sepay', async (req, res) => {
  try {
    const body = req.body;
    console.log('💰 SePay webhook nhận được:', JSON.stringify(body));

    if (body.transferType !== 'in') {
      console.log('⏭ Bỏ qua – không phải tiền vào');
      return res.json({ success: true });
    }

    const noiDung = (body.content || body.description || '').toUpperCase();
    console.log('📝 Nội dung CK:', noiDung);

    const match = noiDung.match(/TSH\d+/);
    if (!match) {
      console.log('⏭ Bỏ qua – không có mã TSH');
      return res.json({ success: true });
    }

    const orderId = match[0];
    console.log('🔑 Mã đơn:', orderId);
    console.log('📦 Cache hiện tại:', JSON.stringify(Object.keys(ordersCache)));

    // Đọc cả RAM lẫn file
    docOrders();
    const donHang = ordersCache[orderId];

    if (!donHang) {
      console.log('⚠️ Không tìm thấy đơn:', orderId);
      console.log('📦 Tất cả đơn đang có:', JSON.stringify(Object.keys(ordersCache)));
      return res.json({ success: true });
    }

    console.log('✅ Xử lý đơn:', donHang);

    const response = await fetch(APPS_SCRIPT_URL, {
      method:   'POST',
      redirect: 'follow',
      headers:  { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:     SECRET_TOKEN,
        ho_ten:    donHang.ho_ten,
        ngay_sinh: donHang.ngay_sinh,
        email:     donHang.email,
        sdt:       donHang.sdt,
        orderId:   orderId
      })
    });

    const text = await response.text();
    console.log('📤 Apps Script response:', text.substring(0, 300));

    try {
      const parsed = JSON.parse(text);
      if (parsed.downloadUrl) {
        ordersCache[orderId + '_done'] = { downloadUrl: parsed.downloadUrl };
        luuOrders();
        console.log('🎉 Đã lưu kết quả cho:', orderId);
      }
    } catch(e) { console.error('Lỗi parse response:', e.message); }

    delete ordersCache[orderId];
    luuOrders();

    return res.json({ success: true });

  } catch (err) {
    console.error('❌ Lỗi webhook:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================================
// API KIỂM TRA ĐƠN – frontend polling
// ================================================================
app.get('/api/kiem-tra-don', (req, res) => {
  const orderId = (req.query.orderId || '').toUpperCase();
  docOrders();
  const done = ordersCache[orderId + '_done'];
  console.log('🔍 Kiểm tra đơn:', orderId, done ? 'CÓ' : 'CHƯA');
  if (done) {
    return res.json({ success: true, downloadUrl: done.downloadUrl });
  }
  return res.json({ success: false });
});

// ================================================================
// API TẠO PDF THỦ CÔNG
// ================================================================
app.post('/api/tao-pdf', async (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;
  console.log('📥 /api/tao-pdf nhận:', { ho_ten, orderId });

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method:   'POST',
      redirect: 'follow',
      headers:  { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: SECRET_TOKEN,
        ho_ten, ngay_sinh,
        email: email || '',
        sdt:   sdt   || '',
        orderId
      })
    });

    const text = await response.text();
    console.log('📤 Apps Script status:', response.status);
    console.log('📤 Apps Script response:', text.substring(0, 500));

    if (text.trim().startsWith('<')) {
      throw new Error('Apps Script trả về HTML – kiểm tra quyền deploy');
    }

    const data = JSON.parse(text);
    res.json(data);

  } catch (err) {
    console.error('❌ Lỗi:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi server: ' + err.message });
  }
});

// ================================================================
// Trả về index.html
// ================================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server chạy trên port ' + PORT));
