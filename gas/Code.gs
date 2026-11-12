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
       sheetState.appendRow([machineId, 0, 0, 0, '1', '2', '3', '4', new Date()]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // ==========================================
  // ส่วนระบบรับข้อมูลจาก Hardware (ESP32/Arduino)
  // โดยช่อง ec เก็บค่าจำนวนรอบ (ครั้ง)
  // ==========================================
  if (action === 'hardware_sync') {
    const sheetState = SpreadsheetApp.openById(SHEET_ID).getSheetByName('MachineState');
    const machineId = e.parameter.machine_id;
    const temp = e.parameter.temperature || 0;
    const ph = e.parameter.ph || 0;
    const ec = e.parameter.ec || 0; // เก็บค่าจำนวนรอบ (ครั้ง)
    const now = new Date();

    let data = sheetState.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == machineId) { 
        rowIndex = i + 1; 
        break; 
      }
    }

    if (rowIndex > -1) {
      sheetState.getRange(rowIndex, 2, 1, 3).setValues([[temp, ph, ec]]);
      sheetState.getRange(rowIndex, 9).setValue(now);
    } else {
      sheetState.appendRow([machineId, temp, ph, ec, '1', '2', '3', '4', now]);
    }

    // บันทึก History (Col D = ec เก็บจำนวนรอบของวันนั้น)
    const sheetHistory = SpreadsheetApp.openById(SHEET_ID).getSheetByName('SensorHistory');
    sheetHistory.appendRow([machineId, temp, ph, ec, now]);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Invalid POST action"})).setMimeType(ContentService.MimeType.JSON);
}

// =========================================
// ฟังก์ชันดึงข้อมูลแสดงผลและจำนวนรอบรายวัน (GET)
// =========================================
function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : null;

  if (action === 'ping') {
    return ContentService.createTextOutput(JSON.stringify({status: "ok"})).setMimeType(ContentService.MimeType.JSON);
  }

  // ส่งข้อมูลเซนเซอร์ (temp, ph) และจำนวนรอบจากช่อง current_ec ให้หน้าเว็บ
  if (action === 'get_current') {
    const sheetState = SpreadsheetApp.openById(SHEET_ID).getSheetByName('MachineState');
    let data = sheetState.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == e.parameter.machine_id) {
        return ContentService.createTextOutput(JSON.stringify({
          current_temp: data[i][1],
          current_ph: data[i][2],
          current_ec: data[i][3] // ช่อง ec เก็บค่าจำนวนรอบ (ครั้งต่อวัน)
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
        result.push({
          temperature: data[i][1],
          ph: data[i][2],
          ec: data[i][3], // ช่อง ec เก็บค่าจำนวนรอบในแต่ละวัน
          recorded_at: data[i][4]
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Invalid GET action"})).setMimeType(ContentService.MimeType.JSON);
}
