const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\index.html';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("$('#cc').onclick")) {
    lines[i] = "$('#cc').onclick=async()=>{SV('cu',$('#cu').value.trim());SV('ct',$('#ct').value.trim());setCst('Connecting...');try{await api('/health');setCst('Connected.');loadAnnouncements();connectWS()}catch(e){setCst(e.message)}};";
    console.log('patched line', i+1);
    break;
  }
}
fs.writeFileSync(p, lines.join('\n'), 'utf8');
