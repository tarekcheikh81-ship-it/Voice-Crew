const fs=require('fs');
const src=fs.readFileSync('w3-js.txt','utf8').split('\n');
const lines=src.filter(l=>/^var (NAMES_RX|BYE_RX|END_RX)=/.test(l)).join('\n');
eval(lines.replace(/^var /gm,'globalThis.'));
const yes=['goodbye','Good bye','bye','Bye bye!','ok thanks, goodbye','Okay, that is all for now. Bye!','thanks Mia, bye','goodbye Mia','Mia goodbye','Goodbye everyone','alright see you later','talk to you soon','ok that\'s all, thanks, goodbye','I think we are good. Bye for now.','good night','Thanks, take care','end the call','hang up','bye Leo, talk later','thank you so much. Have a great day.','perfect, thanks, bye'];
const no=['what does bye mean','tell the team about my goodbye email','take care of the pricing page','we need a goodbye screen for the app','I will say goodbye to the old plan later','that is all wrong','can you say goodbye in French','hello','how do I end the call quality issue','nice, now start on the login','please explain the bye bye feature'];
let bad=0;
for(const t of yes) if(!END_RX.test(t)){console.log('MISS yes:',t);bad++;}
for(const t of no) if(END_RX.test(t)){console.log('FALSE yes:',t);bad++;}
console.log(bad?'failures '+bad:'all good');
