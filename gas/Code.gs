const SHEET_ID = '1FsxuLLKVLCtjMiwmF_w88zeEM7Ni-rbQ77LVvXtvnQ0';

// ==========================================
// ฟังก์ชันรับข้อมูล (POST)
// ==========================================
function doPost(e) {
  if (!e || !e.parameter || !e.parameter.action) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: "No action provided"})).setMimeType(ContentService.MimeType.JSON);
  }

  const action = e.parameter.action;
  
  // สมัครสมาชิก
  if (action === 'register_user') {
    const sheetUsers = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Users');
    const username = e.parameter.username;
    let data = sheetUsers.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] == username) {
        return ContentService.createTextOutput(JSON.stringify({status: "error", message: "ชื่อผู้ใช้นี้มีคนใช้แล้ว"})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    let newUserId = data.length; 
    sheetUsers.appendRow([newUserId, username]);
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // เข้าสู่ระบบ
  if (action === 'login_user') {
    const sheetUsers = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Users');
    const username = e.parameter.username;
    let data = sheetUsers.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] == username) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "success", 
          user_id: data[i][0], 
          username: data[i][1]
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: "ไม่พบชื่อผู้ใช้งานนี้ กรุณาสมัครสมาชิก"})).setMimeType(ContentService.MimeType.JSON);
  }

  // ผูก Machine ID เข้ากับ User
  if (action === 'add_machine') {
    const sheetMachines = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Machines');
    const machineId = e.parameter.machine_id;
    const userId = e.parameter.user_id;
    let data = sheetMachines.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == machineId) {
        return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Machine ID นี้ถูกลงทะเบียนไปแล้ว"})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    sheetMachines.appendRow([machineId, userId]);
    
    const sheetState = SpreadsheetApp.openById(SHEET_ID).getSheetByName('MachineState');
    let stateData = sheetState.getDataRange().getValues();
    let isExist = false;
    for(let i = 1; i < stateData.length; i++){
       if(stateData[i][0] == machineId) { isExist = true; break; }
    }
    if(!isExist) {
       // แถวเริ่มต้น: machineId, temp, ph, ec, m1, m2, p1, p2, date
       sheetState.appendRow([machineId, 0, 0, 0, '0', '0', '0', '0', new Date()]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // ==========================================
  // ส่วนระบบรับข้อมูลจาก Hardware (ESP32/Arduino)
  // ==========================================
  if (action === 'hardware_sync') {
    const sheetState = SpreadsheetApp.openById(SHEET_ID).getSheetByName('MachineState');
    const machineId = e.parameter.machine_id;
    const temp = e.parameter.temperature || 0;
    const ph = e.parameter.ph || 0;
    const ec = e.parameter.ec || 0;
    const now = new Date();

    let data = sheetState.getDataRange().getValues();
    let rowIndex = -1;
    let m1 = '0', m2 = '0', p1 = '0', p2 = '0';

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == machineId) { 
        rowIndex = i + 1; 
        break; 
      }
    }

    if (rowIndex > -1) {
      // อัปเดตค่า Sensor (Col B, C, D) และเวลาล่าสุด (Col I)
      sheetState.getRange(rowIndex, 2, 1, 3).setValues([[temp, ph, ec]]);
      sheetState.getRange(rowIndex, 9).setValue(now);
      
      // ดึงสถานะคำสั่ง 4 ช่องกลับมา (Col E, F, G, H)
      m1 = sheetState.getRange(rowIndex, 5).getValue().toString();
      m2 = sheetState.getRange(rowIndex, 6).getValue().toString();
      p1 = sheetState.getRange(rowIndex, 7).getValue().toString();
      p2 = sheetState.getRange(rowIndex, 8).getValue().toString();
    } else {
      sheetState.appendRow([machineId, temp, ph, ec, '0', '0', '0', '0', now]);
    }

    // บันทึก History
    const sheetHistory = SpreadsheetApp.openById(SHEET_ID).getSheetByName('SensorHistory');
    sheetHistory.appendRow([machineId, temp, ph, ec, now]);

    // ส่ง JSON 4 ช่องกลับไปให้บอร์ดไมโครคอนโทรลเลอร์
    return ContentService.createTextOutput(JSON.stringify({
      status: "success", 
      m1: m1, // "1" หรือ "0"
      m2: m2, // "2" หรือ "0"
      p1: p1, // "3" หรือ "0"
      p2: p2  // "4" หรือ "0"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // ==========================================
  // ส่วนระบบสั่งสวิตช์ 4 ปุ่มจากหน้าเว็บ
  // ==========================================
  if (action === 'set_device_command') {
    const machineId = e.parameter.machine_id;
    const command = e.parameter.command;       // "1", "2", "3", "4" หรือ "0"
    const deviceType = e.parameter.device_type; // "1", "2", "3", "4"
    
    // กำหนด Column ปลายทาง: 1->Col 5, 2->Col 6, 3->Col 7, 4->Col 8
    let colMap = { "1": 5, "2": 6, "3": 7, "4": 8 };
    let targetCol = colMap[deviceType];

    if (!targetCol) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Invalid device_type"})).setMimeType(ContentService.MimeType.JSON);
    }

    return updateCommand(machineId, targetCol, command);
  }

  return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Invalid POST action"})).setMimeType(ContentService.MimeType.JSON);
}

// ฟังก์ชันอัปเดตค่าลงคอลัมน์คำสั่ง
function updateCommand(machineId, colIndex, command) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('MachineState');
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == machineId) {
      sheet.getRange(i + 1, colIndex).setValue(command);
      return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Machine not found"})).setMimeType(ContentService.MimeType.JSON);
}

// =========================================
// ฟังก์ชันจัดการคนเข้าเว็บและดึงข้อมูลให้กราฟ (GET)
// =========================================
function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : null;

  // ส่งข้อมูลเซนเซอร์และสถานะสวิตช์ทั้ง 4 ตัวให้หน้าเว็บ
  if (action === 'get_current') {
    const sheetState = SpreadsheetApp.openById(SHEET_ID).getSheetByName('MachineState');
    let data = sheetState.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == e.parameter.machine_id) {
        return ContentService.createTextOutput(JSON.stringify({
          current_temp: data[i][1],
          current_ph: data[i][2],
          current_ec: data[i][3],
          motor1_command: data[i][4],
          motor2_command: data[i][5],
          pump1_command: data[i][6],
          pump2_command: data[i][7]
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'get_history') {
    const sheetHistory = SpreadsheetApp.openById(SHEET_ID).getSheetByName('SensorHistory');
    let data = sheetHistory.getDataRange().getValues();
    let result = [];
    for(let i = 1; i < data.length; i++) {
      if(data[i][0] == e.parameter.machine_id) { 
        result.push({ temperature: data[i][1], ph: data[i][2], ec: data[i][3], recorded_at: data[i][4] });
      }
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Invalid GET action"})).setMimeType(ContentService.MimeType.JSON);
}

