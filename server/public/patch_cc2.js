const fs = require('fs');
const p = 'C:\\Users\\azuce\\AppData\\Local\\Temp\\opencode\\adaq-auth\\client\\public\\index.html';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("$('#cc').onclick")) {
    lines[i] = "$('#cc').onclick=async()=>{SV('cu',$('#cu').value.trim());SV('ct',$('#ct').value.trim());setCst('Connecting...');const ss=document.getElementById('srvStatus');try{await api('/health');setCst('Connected.');if(ss){ss.textContent='Server address applied: '+$('#cu').value.trim();ss.style.color='#16c784'}loadAnnouncements();connectWS()}catch(e){setCst(e.message);if(ss){ss.textContent='Connection failed';ss.style.color='#ea3943'}}};";
    console.log('patched line', i+1);
    break;
  }
}
// Also update srvStatus on page load if cu is set
const initLine = lines.findIndex(l => l.includes('syInit();'));
if (initLine >= 0) {
  lines.splice(initLine, 0, "const _ss=document.getElementById('srvStatus');if(_ss&&LS('cu','')){_ss.textContent='Server address applied: '+LS('cu','');_ss.style.color='#16c784'}");
  console.log('added init srvStatus at', initLine+1);
}
fs.writeFileSync(p, lines.join('\n'), 'utf8');
