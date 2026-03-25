const express  = require('express');
const path     = require('path');
const fetch    = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const SECRET_TOKEN    = process.env.SECRET_TOKEN    || '';

// ================================================================
// BỘ NHỚ TẠM – lưu đơn hàng chờ thanh toán
// { orderId: { ho_ten, ngay_sinh, email, sdt } }
// ================================================================
const pendingOrders = {}; // đơn chờ thanh toán
const doneOrders = {};    // đơn đã xử lý xong { orderId: { downloadUrl } }

// ================================================================
// API LƯU ĐƠN TẠM – frontend gọi ngay khi khách bấm "Thanh toán"
// ================================================================
app.post('/api/luu-don', (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  // Lưu vào bộ nhớ tạm, tự xóa sau 2 tiếng
  pendingOrders[orderId] = { ho_ten, ngay_sinh, email: email || '', sdt: sdt || '' };
  setTimeout(() => { delete pendingOrders[orderId]; }, 2 * 60 * 60 * 1000);

  console.log('📋 Đã lưu đơn tạm:', orderId, ho_ten);
  return res.json({ success: true });
});

// ================================================================
// WEBHOOK SEPAY – tự động kích hoạt khi có tiền vào
// ================================================================
app.post('/webhook/sepay', async (req, res) => {
  try {
    const body = req.body;
    console.log('💰 SePay webhook nhận được:', JSON.stringify(body));

    // Chỉ xử lý tiền vào
    if (body.transferType !== 'in') {
      console.log('⏭ Bỏ qua – không phải tiền vào');
      return res.json({ success: true });
    }

    // Tìm mã đơn TSH trong nội dung chuyển khoản
    const noiDung = (body.content || body.description || '').toUpperCase();
    console.log('📝 Nội dung CK:', noiDung);

    const match = noiDung.match(/TSH\d+/);
    if (!match) {
      console.log('⏭ Bỏ qua – không có mã đơn TSH trong nội dung');
      return res.json({ success: true });
    }

    const orderId = match[0];
    console.log('🔑 Mã đơn tìm được:', orderId);

    // Lấy thông tin đơn từ bộ nhớ tạm
    const donHang = pendingOrders[orderId];
    if (!donHang) {
      console.log('⚠️ Không tìm thấy đơn trong bộ nhớ tạm:', orderId);
      return res.json({ success: true });
    }

    console.log('✅ Xử lý đơn hàng:', donHang);

    // Gọi Apps Script xuất PDF + lưu sheet + gửi Telegram
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

    // Lưu kết quả vào doneOrders để frontend polling lấy được
    try { const parsed = JSON.parse(text); if (parsed.downloadUrl) { doneOrders[orderId] = { downloadUrl: parsed.downloadUrl }; setTimeout(() => { delete doneOrders[orderId]; }, 30 * 60 * 1000); } } catch(e){}
    // Xóa đơn khỏi bộ nhớ tạm
    delete pendingOrders[orderId];

    return res.json({ success: true });

  } catch (err) {
    console.error('❌ Lỗi webhook SePay:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
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
        token:     SECRET_TOKEN,
        ho_ten,
        ngay_sinh,
        email:     email   || '',
        sdt:       sdt     || '',
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
// API KIỂM TRA ĐƠN – frontend polling mỗi 5 giây
// ================================================================
app.get('/api/kiem-tra-don', (req, res) => {
  const orderId = (req.query.orderId || '').toUpperCase();
  const don = doneOrders[orderId];
  if (don) {
    return res.json({ success: true, downloadUrl: don.downloadUrl });
  }
  return res.json({ success: false });
});

// ================================================================
// Trả về index.html
// ================================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server chạy trên port ' + PORT));
