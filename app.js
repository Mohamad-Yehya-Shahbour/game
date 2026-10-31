(()=>{'use strict';
const $=s=>document.querySelector(s),app=$('#app');const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const random=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');
const labels={mix:'🦩 Flamingo Mix',championship:'🏆 Love Championship',deep:'🌙 Midnight Talks',spicy:'😈 Spicy & Tricky'};
let peer=null,conn=null,role=null,room='',myName='',otherName='',config={mode:'mix',count:20},game=null,remoteView=null,localDraft={},error='';
let reconnectTimer=null, connectAttempt=0, connectionEpoch=0, peerReady=false;
const notify=msg=>{error=msg;render()};
const buildQuestions=()=>{let types=config.mode==='championship'?['know','same','tricky']:config.mode==='deep'?['open','know','same']:config.mode==='spicy'?['tricky','same','know','open']:['know','same','tricky','open'];let pools=Object.fromEntries(types.map(t=>[t,QUESTION_BANK.filter(q=>q.type===t).sort(()=>Math.random()-.5)]));let out=[];for(let i=0;i<config.count;i++){let t=types[i%types.length];if(!pools[t].length)pools[t]=QUESTION_BANK.filter(q=>q.type===t).sort(()=>Math.random()-.5);out.push(pools[t].shift())}return out};
function createGame(){return {phase:'waiting',players:[myName,''],questions:[],idx:0,answers:{},scores:[0,0],history:[],config:{...config}}}
function current(){return role==='host'?game:remoteView}
function qAt(g){return g?.questions?.[g.idx]}
function makeView(){if(!game)return null;let q=qAt(game);let a=game.answers||{};return {phase:game.phase,players:game.players,questions:game.questions,idx:game.idx,scores:game.scores,history:game.history,config:game.config,submitted:[!!a[0],!!a[1]],reveal:game.phase==='reveal'?a:null}}
function sendView(){if(role==='host'){remoteView=makeView();if(conn?.open)conn.send({kind:'state',state:remoteView});render()}}
function updatePhase(){if(game?.phase==='question'&&game.answers[0]&&game.answers[1]){game.phase='reveal';let q=qAt(game),a=game.answers;if(q.type==='know'){for(let i=0;i<2;i++)if(a[i].guess===a[1-i].own)game.scores[i]+=10}else if(q.type==='same'||q.type==='tricky'){if(a[0].own===a[1].own){game.scores[0]+=5;game.scores[1]+=5}}game.history.push({id:q.id,answers:JSON.parse(JSON.stringify(a))})}sendView()}
function submit(idx,answer){if(!game||game.phase!=='question'||game.answers[idx])return;game.answers[idx]=answer;updatePhase()}
function onMessage(data){if(!data||typeof data!=='object')return;if(role==='host'){if(data.kind==='hello'&&game.phase==='waiting'){error='';otherName=String(data.name||'حبيبتي').slice(0,32);game.players[1]=otherName;sendView()}else if(data.kind==='answer'&&game.phase==='question'){let q=qAt(game),v=data.answer;if(validate(q,v))submit(1,v)}else if(data.kind==='nextRequest'&&game.phase==='reveal')next()}else if(data.kind==='state'&&data.state){error='';clearTimeout(reconnectTimer);remoteView=data.state;if(data.state.phase!=='question')localDraft={};render()}}
function validate(q,v){return !!q&&v&&typeof v==='object'&&(q.type==='open'?typeof v.text==='string'&&v.text.length<=1500:q.type==='know'?Number.isInteger(v.own)&&Number.isInteger(v.guess)&&v.own>=0&&v.own<4&&v.guess>=0&&v.guess<4:Number.isInteger(v.own)&&v.own>=0&&v.own<4)}
function disconnectAll(){connectionEpoch++;clearTimeout(reconnectTimer);reconnectTimer=null;peerReady=false;connectAttempt=0;try{conn?.close()}catch{}try{peer?.destroy()}catch{}peer=null;conn=null;role=null;game=null;remoteView=null;localDraft={};error='';history.replaceState(null,'',location.pathname);render()}
function initPeer(id,callback){
 if(typeof Peer==='undefined'){notify('مكتبة الاتصال ما تحمّلت. تأكد من الإنترنت وأعد تحميل الصفحة.');return}
 try{
  const epoch=connectionEpoch;
  peer=new Peer(id,{debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]}});
  peer.on('open',()=>{if(epoch!==connectionEpoch)return;peerReady=true;error='';callback()});
  peer.on('error',e=>{if(epoch!==connectionEpoch)return;let t=e?.type||'';
   if(t==='peer-unavailable'&&role==='guest'){notify('الغرفة مش ظاهرة بخدمة الربط. خلي صاحب الغرفة يفتح الصفحة ويعيد إنشاء الغرفة.');return}
   if(t==='unavailable-id'){notify('هيدا الكود مستخدم. جرّب إنشاء غرفة جديدة.');return}
   error='مشكلة اتصال ('+(t||'network')+'). '+(role==='guest'?'عم نحاول من جديد…':'تأكد إن الصفحة مفتوحة.');render();
   if(role==='guest')scheduleGuestRetry();
  });
  peer.on('disconnected',()=>{if(epoch!==connectionEpoch)return;peerReady=false;try{if(!peer.destroyed)peer.reconnect()}catch{}error='انقطع الاتصال بخدمة الربط. عم نحاول نرجّعه…';render()});
 }catch(e){notify('تعذّر بدء الاتصال: '+e.message)}
}
function scheduleGuestRetry(){
 if(role!=='guest'||remoteView||conn?.open)return;
 clearTimeout(reconnectTimer);
 reconnectTimer=setTimeout(()=>{if(role!=='guest'||remoteView||conn?.open)return;
   if(peer&&!peer.destroyed&&!peer.disconnected&&peer.open)connectGuest();
   else if(peer?.disconnected){try{peer.reconnect()}catch{}}
   scheduleGuestRetry();
 },Math.min(2200+connectAttempt*1100,6500));
}
function bindConnection(c){
 conn=c;
 c.on('data',onMessage);
 c.on('close',()=>{
  if(conn!==c)return;conn=null;
  if(role==='guest'){error='انقطع الاتصال. عم نحاول نرجع للغرفة…';render();scheduleGuestRetry()}
  else {error='انقطع اتصال الشريك. خليه يرجع يفتح رابط الغرفة.';if(game&&game.phase!=='waiting'){game.phase='waiting';game.players[1]='';game.questions=[];game.answers={};game.idx=0;game.scores=[0,0]}render()}
 });
 c.on('error',e=>{if(conn!==c)return;error='الاتصال تعثّر: '+(e?.type||e?.message||'network');render();if(role==='guest')scheduleGuestRetry()});
}
function host(name,mode,count){
 disconnectAll();role='host';myName=name||'أنا';config={mode,count:Number(count)};
 room=random(10);game=createGame();history.replaceState(null,'',location.pathname+'#room='+room);
 initPeer('flamingo-love-'+room,()=>{
  peer.on('connection',c=>{
   if(conn?.open){c.on('open',()=>c.close());return}
   if(game.phase!=='waiting'){c.on('open',()=>c.close());return}
   bindConnection(c);c.on('open',()=>{error='';sendView()});
  });render();
 });render();
}
function connectGuest(){
 if(role!=='guest'||!peer||peer.destroyed||!peer.open||conn?.open)return;
 connectAttempt++;
 try{
  if(conn){try{conn.close()}catch{}conn=null}
  let c=peer.connect('flamingo-love-'+room,{reliable:true,serialization:'json'});
  bindConnection(c);
  c.on('open',()=>{if(role!=='guest'||conn!==c)return;clearTimeout(reconnectTimer);error='';c.send({kind:'hello',name:myName});render()});
  setTimeout(()=>{if(role==='guest'&&conn===c&&!c.open&&!remoteView){try{c.close()}catch{}conn=null;scheduleGuestRetry()}},9000);
 }catch(e){error='تعذّر الاتصال: '+e.message;render();scheduleGuestRetry()}
}
function join(name,code){
 disconnectAll();role='guest';myName=name||'حبيبتي';room=code.toUpperCase().replace(/[^A-Z2-9]/g,'');
 if(room.length!==10){role=null;notify('كود الغرفة لازم يكون 10 أحرف.');return}
 history.replaceState(null,'',location.pathname+'#room='+room);
 initPeer(undefined,()=>{connectGuest();scheduleGuestRetry()});render();
}
// When a mobile browser resumes after switching apps, restore the signaling link.
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState!=='visible'||!role)return;
 if(peer?.disconnected&&!peer.destroyed){try{peer.reconnect()}catch{}}
 if(role==='guest'&&!conn?.open)connectGuest();
 if(role==='host'&&conn?.open)sendView();
});
function start(){if(role!=='host'||game?.phase!=='waiting'||!game.players[1])return;game.questions=buildQuestions();game.phase='question';game.idx=0;game.answers={};sendView()}
function next(){if(role!=='host'||game?.phase!=='reveal')return;game.idx++;game.answers={};game.phase=game.idx>=game.questions.length?'end':'question';sendView()}
function handleAnswer(){let g=current(),q=qAt(g),idx=role==='host'?0:1;if(!q||g.phase!=='question'||g.submitted?.[idx]||game?.answers?.[idx])return;let value;if(q.type==='open'){let text=$('#reply')?.value.trim()||'';if(!text)return;value={text:text.slice(0,1500)}}else if(q.type==='know'){let own=Number(document.querySelector('[name="own"]:checked')?.value),guess=Number(document.querySelector('[name="guess"]:checked')?.value);if(!document.querySelector('[name="own"]:checked')||!document.querySelector('[name="guess"]:checked'))return;value={own,guess}}else{let opt=document.querySelector('[name="own"]:checked');if(!opt)return;value={own:Number(opt.value)}}if(role==='host')submit(0,value);else{localDraft={submittedIndex:g.idx};conn.send({kind:'answer',answer:value});render()}}
const optionList=(q,name,headline)=>`<div class="sectionlabel">${headline}</div><div class="opts">${q.options.map((o,i)=>`<label class="option"><input type="radio" name="${name}" value="${i}"> ${esc(o)}</label>`).join('')}</div>`;
function renderHome(){const code=new URLSearchParams(location.hash.slice(1)).get('room');app.innerHTML=`<section class="hero"><div class="flamingos">🦩</div><h1>قديش بتعرفوا بعض؟</h1></section><section class="panel"><h2>${code?'انضم للغرفة':'يلا نلعب'}</h2><div class="field"><label>اسمك</label><input id="name" maxlength="32" class="input" placeholder="اكتب اسمك" value="${esc(sessionStorage.getItem('flname')||'')}"></div>${code?`<div class="status">كود الغرفة: <b>${esc(code)}</b></div><button id="joinDirect" class="primary" style="margin-top:14px">انضم للغرفة</button><button id="ignoreInvite" class="secondary" style="margin-top:10px">رجوع</button>`:`<div class="actions"><button id="create" class="primary">إنشاء غرفة</button><button id="joinOpen" class="secondary">الدخول بكود</button></div><div id="createForm" class="hide"><div class="line"></div><div class="sectionlabel">نوع اللعبة</div><div class="modes">${Object.entries(labels).map(([key,val])=>`<button class="mode ${key==='mix'?'active':''}" data-mode="${key}"><span>${val.split(' ')[0]}</span>${val.split(' ').slice(1).join(' ')}</button>`).join('')}</div><div class="field"><label>عدد الأسئلة</label><select id="count" class="input"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></div><button id="goCreate" class="primary">إنشاء الغرفة</button></div><div id="joinForm" class="hide"><div class="field"><label>كود الغرفة</label><input id="roomCode" class="input" placeholder="XXXXXXXXXX" maxlength="10" dir="ltr" style="text-align:center;text-transform:uppercase"></div><button id="goJoin" class="primary">انضمام</button></div>`}</section>`;
const name=()=>{let n=$('#name').value.trim()||'حبيبي';sessionStorage.setItem('flname',n);return n};if(code){$('#joinDirect').onclick=()=>join(name(),code);$('#ignoreInvite').onclick=()=>{history.replaceState(null,'',location.pathname);render()}}else{$('#create').onclick=()=>{$('#createForm').classList.toggle('hide');$('#joinForm').classList.add('hide')};$('#joinOpen').onclick=()=>{$('#joinForm').classList.toggle('hide');$('#createForm').classList.add('hide')};document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));el.classList.add('active')});$('#goCreate').onclick=()=>host(name(),document.querySelector('.mode.active').dataset.mode,$('#count').value);$('#goJoin').onclick=()=>join(name(),$('#roomCode').value)} }
function renderWait(g){let isHost=role==='host';let share=location.href;app.innerHTML=`<section class="panel center"><div class="celebrate">${isHost?'🦩':'💌'}</div><h2>${isHost?'الغرفة جاهزة':'عم نتصل بالغرفة...'}</h2>${isHost?`<p>شارك الرابط أو الكود</p><div class="code">${esc(room)}</div><button class="secondary" id="copy">نسخ الرابط</button><div class="members"><span class="member ready">✅ ${esc(myName)}</span><span class="member ${g?.players?.[1]?'ready':''}">${g?.players?.[1]?'✅ '+esc(g.players[1]):'⏳ ناطرين الشريك'}</span></div><button class="primary" id="start" ${!g?.players?.[1]?'disabled':''}>ابدأ اللعبة</button>`:`<p><span class="spinner"></span> ${g?.players?.[0]?'أهلاً! ناطرين صاحب الغرفة يبدأ اللعبة.':'ناطرين اتصال التلفونين...'}</p><div class="code">${esc(room)}</div>`}<p class="subtle">خلّوا الصفحة مفتوحة خلال اللعب.</p>${error?`<div class="error">${esc(error)}</div>`:''}${!isHost&&!g?.players?.[0]?'<button class="secondary" id="retry">إعادة محاولة الاتصال</button>':''}<button id="leave" class="ghost" style="margin-top:15px">الخروج من الغرفة</button></section>`;if($('#retry'))$('#retry').onclick=()=>{error='';connectGuest();scheduleGuestRetry();render()};if($('#copy'))$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(share);$('#copy').textContent='✅ تم نسخ الرابط'}catch{prompt('انسخ رابط الدعوة:',share)}};if($('#start'))$('#start').onclick=start;$('#leave').onclick=disconnectAll}
function answerDisplay(q,a){if(!a)return '—';if(q.type==='open')return esc(a.text);return esc(q.options[a.own]||'—')}
function renderReveal(g,q){let a=g.reveal||{},p=g.players||['الأول','الثاني'];let match=q.type==='know'?null:q.type==='open'?null:a[0]?.own===a[1]?.own;let comp=q.type==='know'?`<div class="answercard"><strong>التوقعات</strong>${esc(p[0])} توقّع: ${esc(q.options[a[0]?.guess]||'—')} ${a[0]?.guess===a[1]?.own?'✅ +10':'💭'}<br>${esc(p[1])} توقّع: ${esc(q.options[a[1]?.guess]||'—')} ${a[1]?.guess===a[0]?.own?'✅ +10':'💭'}</div>`:q.type==='open'?'<div class="status">سؤال مفتوح — بلا نقاط.</div>':`<div class="status">${match?'💞 نفس التفكير! +5 نقاط لكل واحد':'💬 إجابات مختلفة! فرصة حلوة تحكوا ليش.'}</div>`;
app.innerHTML=`<section class="panel"><div class="row"><span class="tag">✨ كشف الإجابات</span><span class="subtle">${g.idx+1} / ${g.questions.length}</span></div><h2 class="question">${esc(q.q)}</h2><div class="answers"><div class="answercard"><strong>💗 ${esc(p[0])}</strong>${answerDisplay(q,a[0])}</div><div class="answercard"><strong>💜 ${esc(p[1])}</strong>${answerDisplay(q,a[1])}</div>${comp}</div><div class="scoregrid" style="margin-top:18px"><div class="scorebox"><div class="subtle">${esc(p[0])}</div><div class="points">${g.scores[0]}</div></div><div class="scorebox"><div class="subtle">${esc(p[1])}</div><div class="points">${g.scores[1]}</div></div></div><button id="next" class="primary" style="margin-top:18px">${g.idx+1>=g.questions.length?'النتيجة':'السؤال التالي'}</button></section>`;$('#next').onclick=()=>{if(role==='host')next();else{conn?.send({kind:'nextRequest'});$('#next').disabled=true;$('#next').textContent='⏳ ناطرين صاحب الغرفة...'}}}
function renderQuestion(g,q){let idx=role==='host'?0:1,done=!!g.submitted?.[idx]||(role==='guest'&&localDraft.submittedIndex===g.idx);let other=!!g.submitted?.[1-idx];let typeNames={know:'🧠 قديش بتعرفني؟',same:'💞 نفس التفكير',tricky:'😈 تريكي',open:'🌙 من القلب'};app.innerHTML=`<section class="panel"><div class="row"><span class="tag">${typeNames[q.type]}</span><span class="subtle">السؤال ${g.idx+1} من ${g.questions.length}</span></div><div class="progress">${Array.from({length:Math.min(g.questions.length,30)},(_,i)=>`<i class="${i<=g.idx?'done':''}"></i>`).join('')}</div><div class="question">${esc(q.q)}</div>${done?`<div class="status center"><div class="celebrate">🔐</div><h2>تم إرسال جوابك</h2><p>${other?'عم نكشف الإجابات...':'بانتظار الشريك'}</p><span class="spinner"></span></div>`:`${q.type==='open'?`<div class="sectionlabel">إجابتك من القلب (ما في نقاط)</div><textarea maxlength="1500" id="reply" class="input" placeholder="جاوب بصراحة وعلى راحتك..." aria-label="إجابتك"></textarea>`:optionList(q,'own',q.type==='know'?'أولاً: شو جوابك إنت عن حالك؟':'اختار جوابك بسرية')}${q.type==='know'?`<div class="line"></div>${optionList(q,'guess','ثانياً: شو بتتوقّع شريكك يجاوب عن حاله؟')}`:''}<button id="submit" class="primary" style="margin-top:22px">تأكيد الجواب</button>`}<p class="subtle center"></p></section>`;if($('#submit'))$('#submit').onclick=handleAnswer}
function renderEnd(g){let p=g.players||['الأول','الثاني'];let winner=g.scores[0]===g.scores[1]?'تعادل حلو بين قلبين 💞':`🏆 ${esc(p[g.scores[0]>g.scores[1]?0:1])} ربِح تحدّي المعرفة!`;app.innerHTML=`<section class="panel center"><div class="celebrate">🎉🦩💗</div><h2>النتيجة النهائية</h2><p>${winner}</p><div class="scoregrid"><div class="scorebox"><div class="subtle">${esc(p[0])}</div><div class="points">${g.scores[0]}</div></div><div class="scorebox"><div class="subtle">${esc(p[1])}</div><div class="points">${g.scores[1]}</div></div></div><p class="subtle"></p><button id="copyResults" class="secondary">📋 انسخوا النتيجة</button>${role==='host'?'<button id="again" class="primary" style="margin-top:12px">جولة جديدة</button>':'<p>صاحب الغرفة فيو يبدأ جولة جديدة.</p>'}<button id="leave" class="ghost" style="margin-top:12px">الخروج للرئيسية</button></section>`;$('#copyResults').onclick=async()=>{let txt=`🦩 Flamingo Love ❤️\n${p[0]}: ${g.scores[0]} نقطة\n${p[1]}: ${g.scores[1]} نقطة\n${winner}`;try{await navigator.clipboard.writeText(txt);$('#copyResults').textContent='✅ نسخنا النتيجة'}catch{prompt('انسخوا النتيجة',txt)}};if($('#again'))$('#again').onclick=()=>{game.questions=buildQuestions();game.idx=0;game.answers={};game.scores=[0,0];game.history=[];game.phase='question';sendView()};$('#leave').onclick=disconnectAll}
function render(){let g=current();if(!role){renderHome();if(error)app.insertAdjacentHTML('afterbegin',`<div class="error">${esc(error)}</div>`);return}if(!g||g.phase==='waiting'){renderWait(g);return}if(g.phase==='end'){renderEnd(g);return}let q=qAt(g);if(!q){notify('صار خلل بعرض السؤال. جرّبوا فتح الغرفة من جديد.');return}if(g.phase==='reveal'){renderReveal(g,q);return}renderQuestion(g,q)}
$('#helpBtn').onclick=()=>$('#helpDialog').showModal();$('#closeHelp').onclick=()=>$('#helpDialog').close();render();
})();
