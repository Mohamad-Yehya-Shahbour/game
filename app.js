(()=>{'use strict';
const $=s=>document.querySelector(s),app=$('#app');const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const random=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');
const labels={mix:'🦩 Flamingo Mix',championship:'🏆 Love Championship',deep:'🌙 Midnight Talks',spicy:'😈 Spicy & Tricky'};
let role=null,room='',myName='',config={mode:'mix',count:20},roomData=null,view=null,unsub=null,localDraft={},error='';
let F=null,db=null,uid='',fbReady=null,online=true,wasOnline=false,busyKey='';
const notify=msg=>{error=msg;render()};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const seat=()=>role==='host'?'h':'g';
const MODE_TYPES={mix:['know','same','tricky','open'],championship:['know','know','same'],deep:['open','open','know','same'],spicy:['tricky','tricky','same','know','open']};
const descs={mix:'خليط حلو من كل شي',championship:'مين بيعرف التاني أكتر؟',deep:'أسئلة من القلب بهدوء الليل',spicy:'غزل ومواقف تريكية'};
const buildQuestions=()=>{const mode=MODE_TYPES[config.mode]?config.mode:'mix',types=MODE_TYPES[mode];const pool=t=>QUESTION_BANK.filter(q=>q.mode===mode&&q.type===t).sort(()=>Math.random()-.5);let pools=Object.fromEntries(types.map(t=>[t,pool(t)]));let out=[];for(let i=0;i<config.count;i++){let t=types[i%types.length];if(!pools[t].length)pools[t]=pool(t);out.push(pools[t].shift())}return out.map(q=>({id:q.id,type:q.type,q:q.q,...(q.options?{options:q.options}:{})}))};
function qAt(g){return g?.questions?.[g.idx]}
function validate(q,v){return !!q&&v&&typeof v==='object'&&(q.type==='open'?typeof v.text==='string'&&v.text.length<=1500:q.type==='know'?Number.isInteger(v.own)&&Number.isInteger(v.guess)&&v.own>=0&&v.own<4&&v.guess>=0&&v.guess<4:Number.isInteger(v.own)&&v.own>=0&&v.own<4)}
// Both phones read/write one saved room in Firebase Realtime Database (no direct phone-to-phone link, so no NAT/TURN problems).
// If a phone sleeps or loses signal the game just waits in the database and continues when it is back.
const FB_URL='https://www.gstatic.com/firebasejs/10.12.2/';
function initFirebase(){
 return fbReady||(fbReady=(async()=>{
  if(typeof FIREBASE_CONFIG==='undefined')throw new Error('firebase-config.js missing');
  const [A,Au,D]=await Promise.all(['app','auth','database'].map(m=>import(FB_URL+'firebase-'+m+'.js')));
  const fbApp=A.getApps().length?A.getApp():A.initializeApp(FIREBASE_CONFIG),auth=Au.getAuth(fbApp);
  db=D.getDatabase(fbApp);F=D;
  const user=await new Promise(res=>{const off=Au.onAuthStateChanged(auth,u=>{off();res(u)})});
  uid=(user||(await Au.signInAnonymously(auth)).user).uid;
  F.onValue(F.ref(db,'.info/connected'),s=>{online=!!s.val();if(online){wasOnline=true;markPresence()}if(role)render()});
 })());
}
async function ensure(){for(let i=0;;i++){try{await initFirebase();return}catch(e){fbReady=null;if(i>=3)throw e;error='عم نتصل بالسيرفر… (محاولة '+(i+2)+')';render();await sleep(1500*(i+1))}}}
async function withRetry(fn){for(let i=0;;i++){try{return await fn()}catch(e){if(i>=3||/permission/i.test(e?.code||e?.message||''))throw e;await sleep(1500*(i+1))}}}
const savedRoom=()=>{try{const s=JSON.parse(localStorage.getItem('flroom')||'null');return s&&s.code?s:null}catch{return null}};
const saveRoom=()=>{try{localStorage.setItem('flroom',JSON.stringify({code:room,role}))}catch{}};
const forgetRoom=()=>{try{localStorage.removeItem('flroom')}catch{}};
const roomRef=sub=>F.ref(db,'rooms/'+room+(sub?'/'+sub:''));
const hashRoom=()=>new URLSearchParams(location.hash.slice(1)).get('room')||'';
function waitHint(){
 if(navigator.onLine===false)return 'ما في إنترنت عندك حالياً. تأكد من الواي فاي أو الداتا.';
 if(role&&!view&&Date.now()-startedAt>8000)return 'الاتصال عم ياخد وقت. تأكد من الإنترنت (واي فاي أو داتا) وجرّب «إعادة محاولة الاتصال».';
 return '';
}
let startedAt=0;
// Keep the screen awake while playing: a sleeping phone drops the connection.
let wakeLock=null;
async function keepAwake(){try{if(!('wakeLock' in navigator)||wakeLock||document.visibilityState!=='visible')return;wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null})}catch{}}
function markPresence(){
 if(!F||!role||!room)return;
 const p=roomRef('presence/'+seat());
 F.onDisconnect(p).set(false).then(()=>F.set(p,true)).catch(()=>{});
}
function buildView(r){
 if(!r)return null;const st=r.state||{},idx=st.idx||0,a=r.answers?.[idx]||{};
 return {phase:st.phase||'waiting',players:[r.players?.h?.name||'',r.players?.g?.name||''],questions:r.questions||[],idx,scores:[st.scores?.[0]||0,st.scores?.[1]||0],config:r.config||{},submitted:[!!a.h,!!a.g],reveal:st.phase==='reveal'?{0:a.h,1:a.g}:null};
}
function current(){return view}
function stop(){try{unsub?.()}catch{}unsub=null;busyKey=''}
function fail(msg,clearHash){stop();role=null;room='';roomData=null;view=null;error=msg;if(clearHash){forgetRoom();history.replaceState(null,'',location.pathname)}render()}
async function leave(del){
 const r=room,rl=role;stop();
 try{if(r&&F&&rl){if(del&&rl==='host')await F.remove(F.ref(db,'rooms/'+r));else{const p=F.ref(db,'rooms/'+r+'/presence/'+(rl==='host'?'h':'g'));F.onDisconnect(p).cancel();await F.set(p,false)}}}catch{}
 if(del)forgetRoom();
 try{wakeLock?.release()}catch{}wakeLock=null;
 role=null;room='';roomData=null;view=null;localDraft={};error='';history.replaceState(null,'',location.pathname);render();
}
const disconnectAll=()=>leave(true);
// Start listening to the room; every change (either player) redraws the screen.
function attach(){
 saveRoom();history.replaceState(null,'',location.pathname+'#room='+room);
 unsub=F.onValue(roomRef(),snap=>{
  roomData=snap.val();
  if(!roomData){if(role)fail('الغرفة انتهت أو انحذفت. اعملوا غرفة جديدة.',true);return}
  if(role==='host'&&roomData.config)config={mode:roomData.config.mode,count:roomData.config.count};
  view=buildView(roomData);error='';maybeAdvance();render();
 },e=>{error='ما قدرنا نقرأ الغرفة ('+(e?.code||'error')+'). تأكد من الإنترنت.';render()});
 markPresence();keepAwake();
}
// Either phone can move the game forward; a transaction guarantees it happens exactly once.
function maybeAdvance(){
 const r=roomData,st=r?.state;if(!st||!view)return;
 if(st.phase==='question'){
  const a=r.answers?.[st.idx],q=view.questions[st.idx];
  if(!(a?.h&&a?.g&&q))return;
  const key=room+':'+(st.round||0)+':'+st.idx;if(busyKey===key)return;busyKey=key;
  F.runTransaction(roomRef('state'),cur=>{
   if(cur===null)return {phase:'question',idx:st.idx};
   if(cur.phase!=='question'||cur.idx!==st.idx)return;
   const sc=[cur.scores?.[0]||0,cur.scores?.[1]||0],A={0:a.h,1:a.g};
   if(q.type==='know'){for(let i=0;i<2;i++)if(A[i].guess===A[1-i].own)sc[i]+=10}
   else if(q.type==='same'||q.type==='tricky'){if(A[0].own===A[1].own){sc[0]+=5;sc[1]+=5}}
   return {...cur,phase:'reveal',scores:sc};
  }).catch(()=>{busyKey=''});
 }else if(st.phase==='end'&&r.answers&&role==='host')F.remove(roomRef('answers')).catch(()=>{});
}
function next(){
 const st=roomData?.state;if(!st||st.phase!=='reveal'||!view)return;const n=view.questions.length;
 F.runTransaction(roomRef('state'),cur=>{
  if(cur===null)return {phase:'reveal',idx:st.idx};
  if(cur.phase!=='reveal'||cur.idx!==st.idx)return;
  return {...cur,idx:cur.idx+1,phase:cur.idx+1>=n?'end':'question'};
 }).catch(()=>{});
}
function start(){
 if(role!=='host'||roomData?.state?.phase!=='waiting'||!roomData.players?.g)return;
 F.update(roomRef(),{questions:buildQuestions(),state:{phase:'question',idx:0,scores:[0,0],round:1}}).catch(()=>notify('ما قدرنا نبدأ اللعبة. تأكد من الإنترنت وجرّب تاني.'));
}
function again(){
 if(role!=='host'||roomData?.state?.phase!=='end')return;
 F.update(roomRef(),{questions:buildQuestions(),state:{phase:'question',idx:0,scores:[0,0],round:(roomData.state.round||0)+1},answers:null}).catch(()=>notify('ما قدرنا نبدأ جولة جديدة. جرّب تاني.'));
}
function handleAnswer(){
 let g=view,q=qAt(g),i=role==='host'?0:1;if(!q||g.phase!=='question'||g.submitted?.[i])return;let value;
 if(q.type==='open'){let text=$('#reply')?.value.trim()||'';if(!text)return;value={text:text.slice(0,1500)}}
 else if(q.type==='know'){if(!document.querySelector('[name="own"]:checked')||!document.querySelector('[name="guess"]:checked'))return;value={own:Number(document.querySelector('[name="own"]:checked').value),guess:Number(document.querySelector('[name="guess"]:checked').value)}}
 else{let opt=document.querySelector('[name="own"]:checked');if(!opt)return;value={own:Number(opt.value)}}
 if(!validate(q,value))return;
 localDraft={submittedIndex:g.idx};
 // Saved locally at once; if the signal is weak it is sent as soon as the connection is back.
 F.set(roomRef('answers/'+g.idx+'/'+seat()),value).catch(()=>{localDraft={};error='ما انحفظ جوابك. جرّب تاني.';render()});
 render();
}
async function host(name,mode,count){
 stop();role='host';myName=name||'أنا';config={mode,count:Number(count)};room='';view=null;roomData=null;error='';startedAt=Date.now();render();
 setTimeout(()=>{if(role&&!view)render()},8500);
 try{await ensure()}catch{return fail('تعذّر الاتصال بالسيرفر. تأكد من الإنترنت وجرّب من جديد.')}
 const old=savedRoom();if(old?.role==='host')F.remove(F.ref(db,'rooms/'+old.code)).catch(()=>{});
 for(let i=0;i<3;i++){
  const code=random(10);
  try{
   await withRetry(()=>F.set(F.ref(db,'rooms/'+code),{createdAt:F.serverTimestamp(),config:{mode:config.mode,count:config.count},players:{h:{uid,name:myName}},state:{phase:'waiting',idx:0,scores:[0,0]}}));
   if(role!=='host')return;room=code;break;
  }catch(e){if(i===2)return fail('ما قدرنا ننشئ الغرفة ('+(e?.code||'error')+'). جرّب من جديد.')}
 }
 attach();
}
async function join(name,code){
 stop();role='guest';myName=name||'حبيبتي';room=(String(code).match(/room=([A-Za-z0-9]+)/)?.[1]||code).toUpperCase().replace(/[^A-Z2-9]/g,'');
 if(room.length!==10){role=null;room='';notify('كود الغرفة لازم يكون 10 أحرف.');return}
 view=null;roomData=null;error='';startedAt=Date.now();render();
 setTimeout(()=>{if(role&&!view)render()},8500);
 const code10=room;
 try{await ensure()}catch{return fail('تعذّر الاتصال بالسيرفر. تأكد من الإنترنت وجرّب من جديد.')}
 let r;try{r=(await withRetry(()=>F.get(F.ref(db,'rooms/'+code10)))).val()}catch{return fail('تعذّر الاتصال بالسيرفر. تأكد من الإنترنت وجرّب من جديد.')}
 if(role!=='guest'||room!==code10)return;
 if(!r)return fail('الغرفة مش موجودة. تأكدوا من الكود أو اطلبوا رابط جديد.',true);
 if(r.players?.h?.uid===uid){role='host';myName=r.players.h.name||myName}
 else if(r.players?.g?.uid===uid)myName=r.players.g.name||myName;
 else if(!r.players?.g){try{await F.set(F.ref(db,'rooms/'+code10+'/players/g'),{uid,name:myName})}catch{return fail('ما قدرنا ندخل الغرفة. يمكن صارت ممتلئة. اطلبوا رابط جديد.')}}
 else return fail('الغرفة مشغولة بلاعب تاني.');
 attach();
}
// Opening the page again (reload, discarded tab, new link click) puts a member straight back into their room.
async function boot(){
 const code=hashRoom();if(!code)return;
 try{
  await ensure();
  const r=(await F.get(F.ref(db,'rooms/'+code))).val();
  if(role||!r)return;
  const isH=r.players?.h?.uid===uid,isG=r.players?.g?.uid===uid;
  if(!isH&&!isG)return;
  room=code;role=isH?'host':'guest';myName=(isH?r.players.h:r.players.g).name||'';startedAt=Date.now();attach();
 }catch{}
}
const poke=()=>{keepAwake();if(db)try{F.goOnline(db)}catch{}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poke()});
addEventListener('online',poke);addEventListener('pageshow',poke);addEventListener('offline',()=>{if(role)render()});
const optionList=(q,name,headline)=>`<div class="sectionlabel">${headline}</div><div class="opts">${q.options.map((o,i)=>`<label class="option"><input type="radio" name="${name}" value="${i}"> ${esc(o)}</label>`).join('')}</div>`;
function renderHome(){const code=hashRoom(),last=!code?savedRoom():null;app.innerHTML=`<section class="hero"><div class="flamingos">🦩</div><h1>قديش بتعرفوا بعض؟</h1></section><section class="panel"><h2>${code?'انضم للغرفة':'يلا نلعب'}</h2><div class="field"><label>اسمك</label><input id="name" maxlength="32" class="input" placeholder="اكتب اسمك" value="${esc(sessionStorage.getItem('flname')||'')}"></div>${code?`<div class="status">كود الغرفة: <b>${esc(code)}</b></div><button id="joinDirect" class="primary" style="margin-top:14px">انضم للغرفة</button><button id="ignoreInvite" class="secondary" style="margin-top:10px">رجوع</button>`:`${last?`<div class="status">غرفتك الأخيرة: <b dir="ltr">${esc(last.code)}</b></div><button id="resume" class="primary" style="margin:10px 0 14px">كمّل اللعب بغرفتك</button>`:''}<div class="actions"><button id="create" class="primary">إنشاء غرفة</button><button id="joinOpen" class="secondary">الدخول بكود</button></div><div id="createForm" class="hide"><div class="line"></div><div class="sectionlabel">نوع اللعبة</div><div class="modes">${Object.entries(labels).map(([key,val])=>`<button class="mode ${key==='mix'?'active':''}" data-mode="${key}"><span>${val.split(' ')[0]}</span>${val.split(' ').slice(1).join(' ')}<small class="subtle" style="margin-top:4px;font-size:11px;line-height:1.4">${descs[key]}</small></button>`).join('')}</div><div class="field"><label>عدد الأسئلة</label><select id="count" class="input"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></div><button id="goCreate" class="primary">إنشاء الغرفة</button></div><div id="joinForm" class="hide"><div class="field"><label>كود الغرفة</label><input id="roomCode" class="input" placeholder="الكود أو الرابط" maxlength="150" dir="ltr" style="text-align:center;text-transform:uppercase"></div><button id="goJoin" class="primary">انضمام</button></div>`}</section>`;
const name=()=>{let n=$('#name').value.trim()||'حبيبي';sessionStorage.setItem('flname',n);return n};if(code){$('#joinDirect').onclick=()=>join(name(),code);$('#ignoreInvite').onclick=()=>{history.replaceState(null,'',location.pathname);render()}}else{if($('#resume'))$('#resume').onclick=()=>join(name(),last.code);$('#create').onclick=()=>{$('#createForm').classList.toggle('hide');$('#joinForm').classList.add('hide')};$('#joinOpen').onclick=()=>{$('#joinForm').classList.toggle('hide');$('#createForm').classList.add('hide')};document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));el.classList.add('active')});$('#goCreate').onclick=()=>host(name(),document.querySelector('.mode.active').dataset.mode,$('#count').value);$('#goJoin').onclick=()=>join(name(),$('#roomCode').value)} }
function renderWait(g){let isHost=role==='host',showHost=isHost&&!!g;let share=location.href;app.innerHTML=`<section class="panel center"><div class="celebrate">${showHost?'🦩':'💌'}</div><h2>${showHost?'الغرفة جاهزة':isHost?'عم نجهّز الغرفة...':g?'تم الدخول للغرفة ✅':'عم نتصل بالغرفة...'}</h2>${showHost?`<p>ابعتوا الرابط لشريكك. الغرفة محفوظة، فيكم تكملوا حتى لو انقطع النت.</p><div class="code">${esc(room)}</div><div class="actions"><button class="primary" id="wa">📲 إرسال عبر واتساب</button><button class="secondary" id="copy">نسخ الرابط</button></div>${navigator.share?'<button class="secondary" id="share" style="margin-top:10px">مشاركة بتطبيق تاني</button>':''}<div class="members"><span class="member ready">✅ ${esc(myName)}</span><span class="member ${g?.players?.[1]?'ready':''}">${g?.players?.[1]?'✅ '+esc(g.players[1]):'⏳ ناطرين الشريك'}</span></div><button class="primary" id="start" ${!g?.players?.[1]?'disabled':''}>ابدأ اللعبة</button>`:`<p><span class="spinner"></span> ${g?.players?.[0]?'أهلاً! ناطرين صاحب الغرفة يبدأ اللعبة.':isHost?'لحظات...':'عم نبحث عن الغرفة...'}</p><div class="code">${esc(room)}</div>`}<p class="subtle">اللعبة محفوظة بالسيرفر. إذا انقطع النت أو سكرتوا الصفحة، افتحوا نفس الرابط وكمّلوا.</p>${error?`<div class="error">${esc(error)}</div>`:''}${waitHint()?`<p class="subtle">${esc(waitHint())}</p>`:''}${!isHost&&!g?.players?.[0]?'<button class="secondary" id="retry">إعادة محاولة الاتصال</button>':''}<button id="leave" class="ghost" style="margin-top:15px">الخروج من الغرفة</button></section>`;if($('#retry'))$('#retry').onclick=()=>join(myName,room);const invite='🦩 تعال نلعب Flamingo Love! افتح الرابط وادخل الغرفة:\n'+share;if($('#wa'))$('#wa').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent(invite),'_blank');if($('#share'))$('#share').onclick=()=>navigator.share({title:'Flamingo Love',text:invite}).catch(()=>{});if($('#copy'))$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(share);$('#copy').textContent='✅ تم نسخ الرابط'}catch{prompt('انسخ رابط الدعوة:',share)}};if($('#start'))$('#start').onclick=start;$('#leave').onclick=disconnectAll}
function answerDisplay(q,a){if(!a)return '—';if(q.type==='open')return esc(a.text);return esc(q.options[a.own]||'—')}
function renderReveal(g,q){let a=g.reveal||g.answers||{},p=g.players||['الأول','الثاني'];let match=q.type==='know'?null:q.type==='open'?null:a[0]?.own===a[1]?.own;let comp=q.type==='know'?`<div class="answercard"><strong>التوقعات</strong>${esc(p[0])} توقّع: ${esc(q.options[a[0]?.guess]||'—')} ${a[0]?.guess===a[1]?.own?'✅ +10':'💭'}<br>${esc(p[1])} توقّع: ${esc(q.options[a[1]?.guess]||'—')} ${a[1]?.guess===a[0]?.own?'✅ +10':'💭'}</div>`:q.type==='open'?'<div class="status">سؤال مفتوح — بلا نقاط.</div>':`<div class="status">${match?'💞 نفس التفكير! +5 نقاط لكل واحد':'💬 إجابات مختلفة! فرصة حلوة تحكوا ليش.'}</div>`;
app.innerHTML=`<section class="panel"><div class="row"><span class="tag">✨ كشف الإجابات</span><span class="subtle">${g.idx+1} / ${g.questions.length}</span></div><h2 class="question">${esc(q.q)}</h2><div class="answers"><div class="answercard"><strong>💗 ${esc(p[0])}</strong>${answerDisplay(q,a[0])}</div><div class="answercard"><strong>💜 ${esc(p[1])}</strong>${answerDisplay(q,a[1])}</div>${comp}</div><div class="scoregrid" style="margin-top:18px"><div class="scorebox"><div class="subtle">${esc(p[0])}</div><div class="points">${g.scores[0]}</div></div><div class="scorebox"><div class="subtle">${esc(p[1])}</div><div class="points">${g.scores[1]}</div></div></div><button id="next" class="primary" style="margin-top:18px">${g.idx+1>=g.questions.length?'النتيجة':'السؤال التالي'}</button></section>`;$('#next').onclick=()=>{next();$('#next').disabled=true}}
function renderQuestion(g,q){let idx=role==='host'?0:1,done=!!g.submitted?.[idx]||(role==='guest'&&localDraft.submittedIndex===g.idx);let other=!!g.submitted?.[1-idx];let typeNames={know:'🧠 قديش بتعرفني؟',same:'💞 نفس التفكير',tricky:'😈 تريكي',open:'🌙 من القلب'};app.innerHTML=`<section class="panel"><div class="row"><span class="tag">${typeNames[q.type]}</span><span class="subtle">السؤال ${g.idx+1} من ${g.questions.length}</span></div><div class="progress">${Array.from({length:Math.min(g.questions.length,30)},(_,i)=>`<i class="${i<=g.idx?'done':''}"></i>`).join('')}</div><div class="question">${esc(q.q)}</div>${done?`<div class="status center"><div class="celebrate">🔐</div><h2>تم إرسال جوابك</h2><p>${other?'عم نكشف الإجابات...':'بانتظار الشريك'}</p><span class="spinner"></span></div>`:`${q.type==='open'?`<div class="sectionlabel">إجابتك من القلب (ما في نقاط)</div><textarea maxlength="1500" id="reply" class="input" placeholder="جاوب بصراحة وعلى راحتك..." aria-label="إجابتك"></textarea>`:optionList(q,'own',q.type==='know'?'أولاً: شو جوابك إنت عن حالك؟':'اختار جوابك بسرية')}${q.type==='know'?`<div class="line"></div>${optionList(q,'guess','ثانياً: شو بتتوقّع شريكك يجاوب عن حاله؟')}`:''}<button id="submit" class="primary" style="margin-top:22px">تأكيد الجواب</button>`}<p class="subtle center"></p></section>`;if($('#submit'))$('#submit').onclick=handleAnswer}
function renderEnd(g){let p=g.players||['الأول','الثاني'];let winner=g.scores[0]===g.scores[1]?'تعادل حلو بين قلبين 💞':`🏆 ${esc(p[g.scores[0]>g.scores[1]?0:1])} ربِح تحدّي المعرفة!`;app.innerHTML=`<section class="panel center"><div class="celebrate">🎉🦩💗</div><h2>النتيجة النهائية</h2><p>${winner}</p><div class="scoregrid"><div class="scorebox"><div class="subtle">${esc(p[0])}</div><div class="points">${g.scores[0]}</div></div><div class="scorebox"><div class="subtle">${esc(p[1])}</div><div class="points">${g.scores[1]}</div></div></div><p class="subtle"></p><button id="copyResults" class="secondary">📋 انسخوا النتيجة</button>${role==='host'?'<button id="again" class="primary" style="margin-top:12px">جولة جديدة</button>':'<p>صاحب الغرفة هو اللي بيبدأ جولة جديدة.</p>'}<button id="leave" class="ghost" style="margin-top:12px">الخروج للرئيسية</button></section>`;$('#copyResults').onclick=async()=>{let txt=`🦩 Flamingo Love ❤️\n${p[0]}: ${g.scores[0]} نقطة\n${p[1]}: ${g.scores[1]} نقطة\n${winner}`;try{await navigator.clipboard.writeText(txt);$('#copyResults').textContent='✅ نسخنا النتيجة'}catch{prompt('انسخوا النتيجة',txt)}};if($('#again'))$('#again').onclick=again;$('#leave').onclick=disconnectAll}
let drawnKey='';
function awayBanner(){
 let msg='';
 if(role&&((!online&&wasOnline)||navigator.onLine===false))msg='انقطع اتصالك بالسيرفر. عم نرجّعه تلقائياً، وجوابك محفوظ وما بيضيع.';
 else if(role&&view&&view.phase!=='waiting'&&roomData?.presence?.[role==='host'?'g':'h']===false)msg='الشريك مش متصل حالياً. اللعبة محفوظة وبتكملوا لما يرجع.';
 if(!msg)return;
 app.insertAdjacentHTML('afterbegin',`<div class="error">${msg} <button id="leaveAway" class="ghost small">الخروج</button></div>`);$('#leaveAway').onclick=()=>leave(false)}
function render(){let g=current();if(!role){drawnKey='';renderHome();if(error)app.insertAdjacentHTML('afterbegin',`<div class="error">${esc(error)}</div>`);return}if(!g||g.phase==='waiting'){drawnKey='';renderWait(g);return}let q=qAt(g);if(g.phase!=='end'&&!q){notify('صار خلل بعرض السؤال. جرّبوا فتح الغرفة من جديد.');return}
 // keep what the player already typed/selected when a connection event redraws the same question
 const key=g.phase+':'+g.idx,keep=key===drawnKey?[...app.querySelectorAll('#reply,input[type=radio]:checked')].map(x=>[x.id||x.name,x.value]):[];drawnKey=key;
 if(g.phase==='end')renderEnd(g);else if(g.phase==='reveal')renderReveal(g,q);else renderQuestion(g,q);
 keep.forEach(([k,v])=>{if(k==='reply'){const t=$('#reply');if(t)t.value=v}else{const r=document.querySelector(`input[name="${k}"][value="${v}"]`);if(r)r.checked=true}});
 awayBanner()}
$('#helpBtn').onclick=()=>$('#helpDialog').showModal();$('#closeHelp').onclick=()=>$('#helpDialog').close();render();boot();
})();
