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
// LƯU TRỮ ĐƠN HÀNG BẰNG FILE JSON (không mất khi restart)
// ================================================================
const ORDERS_FILE = path.join('/tmp', 'orders.json');

function docOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function luuOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
  } catch(e) {
    console.error('Lỗi lưu orders:', e.message);
  }
}

// ================================================================
// API LƯU ĐƠN TẠM – frontend gọi khi khách bấm "Thanh toán"
// ================================================================
app.post('/api/luu-don', (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  const orders = docOrders();
  orders[orderId] = {
    ho_ten, ngay_sinh,
    email: email || '',
    sdt:   sdt   || '',
    thoiGian: Date.now()
  };
  luuOrders(orders);

  console.log('📋 Đã lưu đơn tạm:', orderId, ho_ten);
  return res.json({ success: true });
});

// ================================================================
// WEBHOOK SEPAY – tự động khi có tiền vào
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
      console.log('⏭ Bỏ qua – không có mã đơn TSH');
      return res.json({ success: true });
    }

    const orderId = match[0];
    console.log('🔑 Mã đơn:', orderId);

    const orders = docOrders();
    const donHang = orders[orderId];

    if (!donHang) {
      console.log('⚠️ Không tìm thấy đơn trong file:', orderId);
      return res.json({ success: true });
    }

    console.log('✅ Xử lý đơn hàng:', donHang);

    // Gọi Apps Script
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

    // Lưu kết quả để frontend polling lấy
    try {
      const parsed = JSON.parse(text);
      if (parsed.downloadUrl) {
        orders[orderId + '_done'] = { downloadUrl: parsed.downloadUrl };
        luuOrders(orders);
      }
    } catch(e) {}

    // Xóa đơn chờ
    delete orders[orderId];
    luuOrders(orders);

    return res.json({ success: true });

  } catch (err) {
    console.error('❌ Lỗi webhook SePay:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================================
// API KIỂM TRA ĐƠN – frontend polling mỗi 5 giây
// ================================================================
app.get('/api/kiem-tra-don', (req, res) => {
  const orderId = (req.query.orderId || '').toUpperCase();
  const orders  = docOrders();
  const done    = orders[orderId + '_done'];
  if (done) {
    return res.json({ success: true, downloadUrl: done.downloadUrl });
  }
  return res.json({ success: false });
});

// ================================================================
// API TẠO PDF THỦ CÔNG – giữ lại phòng khi cần
// ================================================================
app.post('/api/tao-pdf', async (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;
  console.log('📥 Nhận request tao-pdf:', { ho_ten, ngay_sinh, email, sdt, orderId });

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
