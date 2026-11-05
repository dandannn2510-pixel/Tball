# Smart Sensor & IoT Control Dashboard

ระบบ Dashboard ติดตามค่าเซนเซอร์ (Temperature, pH, EC) และสั่งงาน Relay/มอเตอร์ 4 ช่อง สำหรับ ESP32 / Arduino พร้อมเชื่อมต่อ Google Sheets และรองรับการ Deploy ขึ้น **Vercel** ผ่าน **GitHub**

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
├── index.html         # หน้าเว็บ Dashboard & Auth แบบ Single Page App ที่ออกแบบใหม่
├── js/
│   ├── config.js      # กำหนด URL ของ Google Apps Script และค่าเกณฑ์เตือน
│   └── app.js         # ระบบจัดการ Auth, กราฟ Chart.js, Polling, และปุ่มสั่งงาน
├── gas/
│   └── Code.gs        # โค้ด Apps Script ฝั่ง Google Sheets สำหรับเก็บประวัติ
├── vercel.json        # ตั้งค่า Routing สำหรับ Vercel
├── .gitignore         # ไฟล์ยกเว้นสำหรับ Git
└── README.md          # คู่มือการติดตั้งและ Deploy
```

---

## 🚀 ขั้นตอนการนำขึ้น GitHub และ Vercel

### ขั้นตอนที่ 1: ติดตั้ง Git และ Push ขึ้น GitHub

เปิด Terminal ในโฟลเดอร์นี้ แล้วรันคำสั่ง:

```bash
# 1. เริ่มต้น git
git init

# 2. เพิ่มไฟล์ทั้งหมดเข้า git
git add .

# 3. บันทึก commit
git commit -m "Initial commit: Smart Sensor Dashboard"

# 4. เปลี่ยนชื่อ branch เป็น main
git branch -M main

# 5. เชื่อมต่อไปยัง GitHub Repository ของคุณ (เปลี่ยน URL เป็นของ repo คุณ)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 6. ดันโค้ดขึ้น GitHub
git push -u origin main
```

*(หมายเหตุ: ต้องไปสร้าง Empty Repository บน [github.com/new](https://github.com/new) ก่อน แล้วนำ URL มาใส่ในขั้นตอนที่ 5)*

---

### ขั้นตอนที่ 2: Deploy ขึ้น Vercel

1. ไปที่เว็บไซต์ **[vercel.com](https://vercel.com/)** และล็อกอินด้วยบัญชี **GitHub**
2. กดปุ่ม **"Add New..."** -> เลือก **"Project"**
3. ค้นหาชื่อ Repository ที่เพิ่ง Push ขึ้นไป แล้วกด **"Import"**
4. ในหน้าตั้งค่าโปรเจกต์:
   - **Framework Preset**: เลือก `Other` (หรือปล่อยเป็น Auto-detect ได้เลย)
   - **Root Directory**: `./` (ค่าเริ่มต้น)
5. กดปุ่ม **"Deploy"**
6. ภายใน 10-20 วินาที คุณจะได้ลิงก์เว็บจริง เช่น `https://your-project.vercel.app` ใช้งานได้ทันทีทั่วโลก!

---

## ⚙️ การตั้งค่าเพิ่มเติม

- หากมีการแก้ไขหรือ Deploy Google Apps Script ใหม่ สามารถนำ URL ใหม่มาเปลี่ยนได้ที่ไฟล์ `js/config.js` ในส่วน `API_URL`
- ข้อมูลจากบอร์ดไมโครคอนโทรลเลอร์ (ESP32) ยังคงส่งเข้า Google Sheets ที่เดิมได้ตามปกติ โดยไม่ต้องแก้โค้ดที่บอร์ด

