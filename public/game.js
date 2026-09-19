(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const loading = document.querySelector('#loading');
  const playButton = document.querySelector('#play');
  const loadFill = document.querySelector('#loadfill');
  const pausePanel = document.querySelector('#pause');
  const announceBox = document.querySelector('#announce');

  const W = 1280, H = 720, WORLD_W = 5000, WORLD_H = 4000;
  const SAVE_KEY = 'lantern-realms-save-v1';
  const keys = new Set(), pressed = new Set();
  let mouse = { x:W/2, y:H/2, down:false, clicked:false };
  let gamepadPrev = [];
  let last = performance.now(), started = false, noticeTimer = 0, autosaveTimer = 0;

  const imageFiles = {
    terrain:'assets/rpg-terrain-chatgpt.png', monsters:'assets/rpg-monsters-chatgpt.png',
    npcs:'assets/rpg-npcs-chatgpt.png', gear:'assets/rpg-equipment-chatgpt.png',
    landmarks:'assets/rpg-landmarks-chatgpt.png', buildings:'assets/open-adventure-buildings-chatgpt.png',
    camps:'assets/open-adventure-camps-chatgpt.png'
  };
  const art = {};
  let loaded = 0;
  Object.entries(imageFiles).forEach(([name, src]) => {
    const img = new Image(); art[name] = img;
    img.onload = img.onerror = () => {
      loaded++; loadFill.style.width = `${loaded / Object.keys(imageFiles).length * 100}%`;
      if (loaded === Object.keys(imageFiles).length) {
        playButton.disabled = false; playButton.textContent = 'BEGIN ADVENTURE';
      }
    };
    img.src = src;
  });

  const state = {
    mode:'title', time:0, quest:0, shards:0, bossDead:false, ending:false,
    dialogue:null, dialogueIndex:0, inventoryOpen:false, mapOpen:false,
    camera:{x:0,y:0}, shake:0, flash:0, particles:[], floaters:[], loot:[], projectiles:[],
    discovered:new Set(), opened:new Set(), defeated:new Set(),
    player:{x:840,y:1980,vx:0,vy:0,r:24,facing:1,hp:100,maxHp:100,level:1,xp:0,nextXp:100,gold:0,potions:2,attack:0,dash:0,invuln:0,weapon:0},
    stats:{enemies:0,chests:0,steps:0}
  };

  const roads = [
    {x:620,y:1780,w:1500,h:250}, {x:1880,y:1870,w:1350,h:100},
    {x:3100,y:1260,w:100,h:1450}, {x:1100,y:2850,w:2300,h:100},
    {x:4030,y:1770,w:760,h:160}
  ];
  const water = { x:2200, width:330 };
  const bridge = { x:2150, y:1785, w:430, h:225 };
  const houses = [
    {id:'inn',x:620,y:1390,w:255,h:210,art:0,label:'Moonlight Inn'},
    {id:'forge',x:1020,y:1370,w:255,h:220,art:2,label:'Ember Forge'},
    {id:'shop',x:1450,y:1420,w:255,h:200,art:3,label:'Potion Shop'},
    {id:'hall',x:720,y:2180,w:280,h:220,art:5,label:'Quest Hall'},
    {id:'shrine',x:1450,y:2200,w:250,h:205,art:4,label:'Lantern Shrine'}
  ];
  const landmarks = [
    {x:4370,y:1730,w:330,h:330,art:15,label:'Black Crown Keep'},
    {x:3210,y:1030,w:190,h:190,art:8,label:'North Camp'},
    {x:3440,y:2920,w:190,h:190,art:18,label:'Ash Camp'},
    {x:1320,y:3020,w:190,h:190,art:16,label:'Old Ruin'}
  ];
  const campCenters = [{id:'north',x:3300,y:1200},{id:'ash',x:3540,y:3060},{id:'ruin',x:1420,y:3160}];
  const npcs = [
    {id:'elder',name:'Elder Luma',x:1130,y:1940,art:4,color:'#ffe27a'},
    {id:'smith',name:'Bran the Smith',x:1110,y:1650,art:2,color:'#ffb35f'},
    {id:'healer',name:'Mira',x:1550,y:1680,art:3,color:'#78f0e0'},
    {id:'scout',name:'Pip',x:750,y:1680,art:8,color:'#95d979'},
    {id:'guard',name:'Sir Rowan',x:1900,y:1900,art:9,color:'#8abaff'}
  ];
  const chests = [
    {id:'village',x:1550,y:2070,tier:0},{id:'north',x:3350,y:1250,tier:1},
    {id:'ash',x:3600,y:3100,tier:1},{id:'ruin',x:1480,y:3200,tier:1},
    {id:'forest',x:690,y:700,tier:1},{id:'desert',x:3940,y:690,tier:2},
    {id:'keep',x:4520,y:2130,tier:2}
  ];
  const enemies = [];

  function makeEnemies() {
    enemies.length = 0;
    const types = [0,2,3,4,5,8,10];
    campCenters.forEach((camp, ci) => {
      for (let i=0;i<6;i++) spawnEnemy(`${camp.id}-${i}`,camp.x + Math.cos(i*1.047)*150,camp.y+Math.sin(i*1.047)*125,types[(ci*2+i)%types.length],ci===2?2:1,camp.id,i===0);
    });
    [[2700,700],[2900,2200],[1800,900],[4100,2900],[850,3300],[3850,1450],[2800,3400]].forEach((p,i)=>spawnEnemy(`wild-${i}`,p[0],p[1],types[(i+1)%types.length],1,null,false));
    spawnEnemy('boss',4520,1910,14,6,'boss',false,true);
  }
  function spawnEnemy(id,x,y,artIndex,rank,camp,shard=false,boss=false) {
    if (state.defeated.has(id)) return;
    const maxHp = boss ? 650 : 45 + rank*28;
    enemies.push({id,x,y,homeX:x,homeY:y,vx:0,vy:0,r:boss?52:28,art:artIndex,rank,camp,shard,boss,hp:maxHp,maxHp,attack:Math.random(),hurt:0,stun:0,dead:false});
  }

  const decorations = [];
  function hash(x,y,s=1){ let n=(x*374761393+y*668265263+s*69069)|0; n=(n^(n>>>13))*1274126177; return ((n^(n>>>16))>>>0)/4294967295; }
  for(let y=120;y<WORLD_H-100;y+=180) for(let x=100;x<WORLD_W-100;x+=190) {
    const n=hash(x,y); if(n<.44) continue;
    if(x>520&&x<2050&&y>1280&&y<2500) continue;
    if(Math.abs(x-water.x-water.width/2)<260) continue;
    let type = n<.62?1:n<.76?2:n<.88?3:4;
    if(y>2800&&x>2700) type=10+(Math.floor(n*20)%4);
    if(x>3600&&y<1200) type=12;
    decorations.push({x:x+(hash(y,x)-.5)*90,y:y+(hash(x+7,y)-.5)*80,type,solid:type!==0&&type!==2,r:type===1?43:30});
  }

  function save() {
    const p=state.player;
    localStorage.setItem(SAVE_KEY,JSON.stringify({
      version:1, quest:state.quest, shards:state.shards,bossDead:state.bossDead,
      opened:[...state.opened],defeated:[...state.defeated],discovered:[...state.discovered],
      player:{x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,level:p.level,xp:p.xp,nextXp:p.nextXp,gold:p.gold,potions:p.potions,weapon:p.weapon},stats:state.stats
    }));
  }
  function loadSave() {
    try {
      const s=JSON.parse(localStorage.getItem(SAVE_KEY)); if(!s||s.version!==1)return;
      Object.assign(state,{quest:s.quest||0,shards:s.shards||0,bossDead:!!s.bossDead});
      Object.assign(state.player,s.player||{}); Object.assign(state.stats,s.stats||{});
      state.opened=new Set(s.opened||[]);state.defeated=new Set(s.defeated||[]);state.discovered=new Set(s.discovered||[]);
    } catch {}
  }
  function resetGame(){ localStorage.removeItem(SAVE_KEY); location.reload(); }

  function atlas(img,index,cols,rows,x,y,w,h,flip=false,alpha=1) {
    if(!img||!img.complete||!img.naturalWidth)return;
    const sw=img.naturalWidth/cols,sh=img.naturalHeight/rows,sx=(index%cols)*sw,sy=Math.floor(index/cols)*sh;
    ctx.save();ctx.globalAlpha=alpha;
    if(flip){ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(img,sx,sy,sw,sh,0,0,w,h);}else ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);
    ctx.restore();
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
  function rectHitCircle(rect,x,y,r){const cx=clamp(x,rect.x,rect.x+rect.w),cy=clamp(y,rect.y,rect.y+rect.h);return Math.hypot(x-cx,y-cy)<r;}
  function visible(x,y,pad=120){const c=state.camera;return x>c.x-pad&&x<c.x+W+pad&&y>c.y-pad&&y<c.y+H+pad;}
  function worldToScreen(x,y){return{x:x-state.camera.x,y:y-state.camera.y};}

  function isBlocked(x,y,r) {
    if(x<35||y<35||x>WORLD_W-35||y>WORLD_H-35)return true;
    if(x>water.x&&x<water.x+water.width && !(y>bridge.y&&y<bridge.y+bridge.h))return true;
    for(const h of houses) if(rectHitCircle({x:h.x+20,y:h.y+25,w:h.w-40,h:h.h-40},x,y,r))return true;
    for(const d of decorations) if(d.solid&&Math.hypot(x-d.x,y-d.y)<r+d.r*.6)return true;
    return false;
  }
  function moveBody(body,dx,dy) {
    const nx=body.x+dx;if(!isBlocked(nx,body.y,body.r*.7))body.x=nx;
    const ny=body.y+dy;if(!isBlocked(body.x,ny,body.r*.7))body.y=ny;
  }

  function announce(text,color='#fff2b2') {
    announceBox.textContent=text;announceBox.style.color=color;announceBox.classList.add('show');noticeTimer=2.7;
  }
  function dialogue(name,lines,portrait=4,onDone=null) {
    state.dialogue={name,lines:Array.isArray(lines)?lines:[lines],portrait,onDone};state.dialogueIndex=0;state.mode='dialogue';
  }
  function currentQuestText(){
    if(state.quest===0)return 'Talk to Elder Luma';
    if(state.quest===1)return `Recover Moonshards  ${state.shards}/3`;
    if(state.quest===2)return 'Defeat the Warden at Black Crown Keep';
    if(state.quest===3)return 'Return to Elder Luma';
    return 'The realm is safe — keep exploring';
  }

  function interact() {
    const p=state.player;
    const npc=npcs.find(n=>dist(p,n)<95);
    if(npc){talk(npc);return;}
    const chest=chests.find(c=>!state.opened.has(c.id)&&dist(p,c)<95);
    if(chest){openChest(chest);return;}
    if(!state.bossDead&&Math.hypot(p.x-4390,p.y-1900)<190&&state.quest<2){announce('A dark seal blocks the keep. Find all 3 Moonshards.','#bd8cff');return;}
    announce('Nothing nearby to use.','#d7e5dc');
  }
  function talk(npc) {
    if(npc.id==='elder') {
      if(state.quest===0) dialogue(npc.name,['The Black Crown stole our three Moonshards.','Follow the roads to the marked camps, defeat their captains, and bring the light home.'],npc.art,()=>{state.quest=1;announce('QUEST STARTED: The Three Moonshards','#ffe16a');save();});
      else if(state.quest===1) dialogue(npc.name,[state.shards?`You have ${state.shards} of the 3 Moonshards. The others still call from beyond the river.`:'The camp captains guard the Moonshards. Your map marks their camps.'],npc.art);
      else if(state.quest===2) dialogue(npc.name,['The three lights are one again. The seal on Black Crown Keep is broken.','Face the Shadow Warden in the east. Take every potion you can carry.'],npc.art);
      else if(state.quest===3) dialogue(npc.name,['You came back! The Warden is gone and every lantern burns again.','You are the new Lantern Keeper. The roads are yours to explore.'],npc.art,()=>{state.quest=4;state.ending=true;gainGold(500);gainXp(500);save();});
      else dialogue(npc.name,['Lantern Keeper, the realm remembers what you did. There are still monsters and hidden chests beyond our roads.'],npc.art);
    } else if(npc.id==='smith') {
      if(state.player.weapon<2&&state.player.gold>=80){dialogue(npc.name,['I can sharpen your blade for 80 gold. Press attack while this message is open to accept.'],npc.art);}
      else dialogue(npc.name,[state.player.weapon>=2?'That blade can cut moonlight. I have nothing stronger.':'Bring me 80 gold and I will strengthen your sword.'],npc.art);
    } else if(npc.id==='healer') {
      state.player.hp=state.player.maxHp; dialogue(npc.name,['Rest here, traveler. Your health is restored.'],npc.art); save();
    } else if(npc.id==='scout') dialogue(npc.name,['The blue river is deep, but the stone road crosses it safely.','I saw a treasure chest hidden far northwest in the forest.'],npc.art);
    else dialogue(npc.name,[state.quest<2?'The eastern keep is sealed. The Moonshards should open it.':'The keep is open. I will hold the bridge while you face the Warden.'],npc.art);
  }
  function openChest(chest) {
    state.opened.add(chest.id);state.stats.chests++;const gold=30+chest.tier*35+Math.floor(Math.random()*35),potions=1+(Math.random()<.35+chest.tier*.2?1:0);
    gainGold(gold);state.player.potions+=potions;burst(chest.x,chest.y,'#ffd84f',24);
    dialogue('TREASURE CHEST',[`Found ${gold} gold and ${potions} healing potion${potions===1?'':'s'}!`],chest.tier?13:8);
    save();
  }

  function attack() {
    const p=state.player;if(p.attack>0||p.dash>0)return;
    p.attack=.34;state.shake=3;
    const aim=getAim();const reach=88+state.player.weapon*7;let hit=false;
    for(const e of enemies){
      if(e.dead)continue;const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);if(d>reach+e.r)continue;
      if((dx*aim.x+dy*aim.y)/(d||1)<.25)continue;
      const damage=26+p.level*4+p.weapon*11;e.hp-=damage;e.hurt=.2;e.stun=.17;e.vx+=aim.x*270;e.vy+=aim.y*270;hit=true;
      floater(e.x,e.y-45,`-${damage}`,'#fff29c');burst(e.x,e.y,'#ff705a',8);
      if(e.hp<=0)killEnemy(e);
    }
    if(hit)state.shake=5;
  }
  function killEnemy(e) {
    e.dead=true;state.defeated.add(e.id);state.stats.enemies++;gainXp(e.boss?300:18+e.rank*8);burst(e.x,e.y,e.boss?'#b869ff':'#ff985c',22);
    if(e.shard){state.shards++;state.loot.push({x:e.x,y:e.y,type:'shard',life:99});announce(`MOONSHARD FOUND  ${state.shards}/3`,'#80eeff');if(state.shards>=3){state.quest=2;announce('ALL SHARDS FOUND — THE KEEP IS OPEN','#ffe573');}}
    else if(e.boss){state.bossDead=true;state.quest=3;announce('SHADOW WARDEN DEFEATED! Return to Elder Luma.','#ffe573');}
    else if(Math.random()<.55) state.loot.push({x:e.x,y:e.y,type:Math.random()<.28?'potion':'gold',life:60});
    save();
  }
  function gainGold(n){state.player.gold+=n;floater(state.player.x,state.player.y-65,`+${n} GOLD`,'#ffd853');}
  function gainXp(n){
    if(!n)return;const p=state.player;p.xp+=n;floater(p.x,p.y-95,`+${n} XP`,'#73eaff');
    while(p.xp>=p.nextXp){p.xp-=p.nextXp;p.level++;p.nextXp=Math.floor(p.nextXp*1.45);p.maxHp+=18;p.hp=p.maxHp;announce(`LEVEL ${p.level}!  MAX HEALTH INCREASED`,'#83f3ff');burst(p.x,p.y,'#75e8ff',30);}
  }
  function usePotion(){const p=state.player;if(p.potions<=0||p.hp>=p.maxHp){announce(p.potions?'Health is already full.':'You have no potions.');return;}p.potions--;p.hp=Math.min(p.maxHp,p.hp+55);burst(p.x,p.y,'#70eea2',16);announce('Healing potion used!','#72f0a4');save();}
  function dash(){const p=state.player;if(p.dash>0)return;const m=getMove();if(!m.x&&!m.y)return;p.dash=.45;p.invuln=.3;p.vx=m.x*700;p.vy=m.y*700;burst(p.x,p.y,'#dbf7ff',8);}

  function gainSmithUpgrade(){const p=state.player;if(p.gold>=80&&p.weapon<2){p.gold-=80;p.weapon++;announce(`SWORD UPGRADED — +${p.weapon*11} DAMAGE`,'#ffcc62');burst(p.x,p.y,'#ffbd4a',18);state.mode='game';state.dialogue=null;save();return true;}return false;}

  function getMove(){
    let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),y=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
    const gp=navigator.getGamepads?.()[0];if(gp){let gx=Math.abs(gp.axes[0]||0)>.18?gp.axes[0]:0,gy=Math.abs(gp.axes[1]||0)>.18?gp.axes[1]:0;if(!gx)gx=(gp.buttons[15]?.pressed?1:0)-(gp.buttons[14]?.pressed?1:0);if(!gy)gy=(gp.buttons[13]?.pressed?1:0)-(gp.buttons[12]?.pressed?1:0);if(gx||gy){x=gx;y=gy;}}
    const len=Math.hypot(x,y);return len>1?{x:x/len,y:y/len}:{x,y};
  }
  function getAim(){
    const p=state.player,gp=navigator.getGamepads?.()[0];if(gp){const x=gp.axes[2]||0,y=gp.axes[3]||0,l=Math.hypot(x,y);if(l>.28)return{x:x/l,y:y/l};}
    const ps=worldToScreen(p.x,p.y),dx=mouse.x-ps.x,dy=mouse.y-ps.y,l=Math.hypot(dx,dy);if(l>30)return{x:dx/l,y:dy/l};
    let nearest=null,nd=480;for(const e of enemies)if(!e.dead&&visible(e.x,e.y)){const d=dist(p,e);if(d<nd){nd=d;nearest=e;}}
    if(nearest){const dx=nearest.x-p.x,dy=nearest.y-p.y,d=Math.hypot(dx,dy);return{x:dx/d,y:dy/d};}
    return{x:p.facing,y:0};
  }

  function updateGamepad() {
    const gp=navigator.getGamepads?.()[0];if(!gp){gamepadPrev=[];return;}
    const now=gp.buttons.map(b=>b.pressed),tap=i=>now[i]&&!gamepadPrev[i];
    if(tap(0)) actionInteract(); if(tap(1)) dash(); if(tap(2)||tap(7)) actionAttack(); if(tap(3)) toggleInventory();if(tap(5))usePotion();
    if(tap(8))toggleMap();if(tap(9))togglePause();if(tap(12))pressed.add('ArrowUp');if(tap(13))pressed.add('ArrowDown');if(tap(14))pressed.add('ArrowLeft');if(tap(15))pressed.add('ArrowRight');
    gamepadPrev=now;
  }
  function actionAttack(){if(state.mode==='game')attack();else if(state.mode==='dialogue'&&state.dialogue?.name==='Bran the Smith')gainSmithUpgrade();}
  function actionInteract(){if(state.ending){state.ending=false;return;}if(state.mode==='game')interact();else if(state.mode==='dialogue')advanceDialogue();else if(state.mode==='dead')respawn();}
  function advanceDialogue(){const d=state.dialogue;if(!d)return;if(state.dialogueIndex<d.lines.length-1){state.dialogueIndex++;}else{state.mode='game';state.dialogue=null;if(d.onDone)d.onDone();}}
  function toggleInventory(){if(state.mode==='game'){state.mode='inventory';state.inventoryOpen=true;}else if(state.mode==='inventory'){state.mode='game';state.inventoryOpen=false;}}
  function toggleMap(){if(state.mode==='game'){state.mode='map';state.mapOpen=true;}else if(state.mode==='map'){state.mode='game';state.mapOpen=false;}}
  function togglePause(){if(state.mode==='paused'){state.mode='game';pausePanel.classList.add('hidden');}else if(state.mode==='game'){state.mode='paused';pausePanel.classList.remove('hidden');save();}}

  function update(dt) {
    state.time+=dt;if(noticeTimer>0&&(noticeTimer-=dt)<=0)announceBox.classList.remove('show');updateGamepad();
    if(state.mode==='game')updateWorld(dt);
    updateEffects(dt);mouse.clicked=false;pressed.clear();
    if((autosaveTimer+=dt)>12){autosaveTimer=0;save();}
  }
  function updateWorld(dt) {
    const p=state.player;p.attack=Math.max(0,p.attack-dt);p.dash=Math.max(0,p.dash-dt);p.invuln=Math.max(0,p.invuln-dt);
    const move=getMove(),speed=p.dash>0?1:245;
    if(p.dash<=0){p.vx+=(move.x*speed-p.vx)*Math.min(1,dt*13);p.vy+=(move.y*speed-p.vy)*Math.min(1,dt*13);} else {p.vx*=Math.pow(.04,dt);p.vy*=Math.pow(.04,dt);}
    if(Math.abs(p.vx)>2||Math.abs(p.vy)>2){moveBody(p,p.vx*dt,p.vy*dt);state.stats.steps+=Math.hypot(p.vx,p.vy)*dt;if(Math.abs(p.vx)>10)p.facing=Math.sign(p.vx);}
    const region=`${Math.floor(p.x/500)},${Math.floor(p.y/500)}`;state.discovered.add(region);
    for(const item of state.loot){item.life-=dt;if(dist(p,item)<58){if(item.type==='gold')gainGold(12+Math.floor(Math.random()*18));if(item.type==='potion')p.potions++;item.life=0;}}
    state.loot=state.loot.filter(i=>i.life>0||i.type==='shard');
    for(const e of enemies)updateEnemy(e,dt);
    updateProjectiles(dt);
    const targetX=clamp(p.x-W/2,0,WORLD_W-W),targetY=clamp(p.y-H/2,0,WORLD_H-H);
    state.camera.x+=(targetX-state.camera.x)*Math.min(1,dt*8);state.camera.y+=(targetY-state.camera.y)*Math.min(1,dt*8);
    state.shake=Math.max(0,state.shake-dt*18);state.flash=Math.max(0,state.flash-dt);
  }
  function updateEnemy(e,dt) {
    if(e.dead)return;e.attack=Math.max(0,e.attack-dt);e.hurt=Math.max(0,e.hurt-dt);e.stun=Math.max(0,e.stun-dt);
    const p=state.player,d=dist(e,p);let tx=e.homeX,ty=e.homeY;
    if(d<430&&!(e.boss&&state.quest<2)){tx=p.x;ty=p.y;}else if(Math.hypot(e.x-e.homeX,e.y-e.homeY)<25){tx=e.homeX+Math.sin(state.time*.6+e.x)*70;ty=e.homeY+Math.cos(state.time*.7+e.y)*70;}
    if(e.stun<=0){const dx=tx-e.x,dy=ty-e.y,l=Math.hypot(dx,dy)||1,s=(e.boss?112:82+e.rank*5);e.vx+=(dx/l*s-e.vx)*Math.min(1,dt*4);e.vy+=(dy/l*s-e.vy)*Math.min(1,dt*4);}else {e.vx*=Math.pow(.08,dt);e.vy*=Math.pow(.08,dt);}
    if(d>65+e.r)moveBody(e,e.vx*dt,e.vy*dt);
    if(d<64+e.r&&e.attack<=0&&p.invuln<=0){e.attack=e.boss?.65:1.05;hurtPlayer(e.boss?24:9+e.rank*3,e);}
    if(e.boss&&d<360&&e.attack<=.05&&Math.random()<dt*1.4){const dx=p.x-e.x,dy=p.y-e.y,l=Math.hypot(dx,dy)||1;state.projectiles.push({x:e.x,y:e.y,vx:dx/l*330,vy:dy/l*330,life:2.2,r:15,damage:17});e.attack=.7;}
  }
  function updateProjectiles(dt){const p=state.player;for(const b of state.projectiles){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(Math.hypot(b.x-p.x,b.y-p.y)<b.r+p.r&&p.invuln<=0){hurtPlayer(b.damage,{x:b.x,y:b.y});b.life=0;}}state.projectiles=state.projectiles.filter(b=>b.life>0&&!isBlocked(b.x,b.y,b.r));}
  function hurtPlayer(amount,source){const p=state.player;if(p.invuln>0)return;p.hp-=amount;p.invuln=.7;state.flash=.12;state.shake=8;const dx=p.x-source.x,dy=p.y-source.y,l=Math.hypot(dx,dy)||1;moveBody(p,dx/l*25,dy/l*25);floater(p.x,p.y-55,`-${amount}`,'#ff746d');if(p.hp<=0){p.hp=0;state.mode='dead';save();}}
  function respawn(){const p=state.player;p.x=1120;p.y=1980;p.hp=p.maxHp;p.gold=Math.max(0,p.gold-25);p.invuln=2;state.mode='game';state.projectiles=[];announce('The village lantern returned you safely.  -25 gold','#ffe19a');save();}
  function updateEffects(dt){for(const p of state.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=80*dt;p.life-=dt;}state.particles=state.particles.filter(p=>p.life>0);for(const f of state.floaters){f.y-=35*dt;f.life-=dt;}state.floaters=state.floaters.filter(f=>f.life>0);}
  function burst(x,y,color,n){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=35+Math.random()*130;state.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-40,life:.35+Math.random()*.45,color,size:3+Math.random()*5});}}
  function floater(x,y,text,color){state.floaters.push({x,y,text,color,life:1.1});}

  function groundColor(x,y){
    if(x>3600&&y<1250)return '#9a713b';
    if(x>2700&&y>2750)return '#586677';
    if(x<1150&&y<1150)return '#2c6544';
    return '#4f9553';
  }
  function draw() {
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);
    if(state.mode==='title')return;
    const sx=state.shake?(Math.random()-.5)*state.shake:0,sy=state.shake?(Math.random()-.5)*state.shake:0;ctx.save();ctx.translate(sx,sy);
    drawGround();drawWorldObjects();drawEntities();drawEffects();ctx.restore();drawHud();
    if(state.mode==='dialogue')drawDialogue();if(state.mode==='inventory')drawInventory();if(state.mode==='map')drawMap();if(state.mode==='dead')drawDeath();if(state.ending)drawEnding();
    if(state.flash>0){ctx.fillStyle='#ff493955';ctx.fillRect(0,0,W,H);}
  }
  function drawGround(){
    const c=state.camera,tile=80,startX=Math.floor(c.x/tile)*tile,startY=Math.floor(c.y/tile)*tile;
    for(let y=startY;y<c.y+H+tile;y+=tile)for(let x=startX;x<c.x+W+tile;x+=tile){ctx.fillStyle=groundColor(x,y);ctx.fillRect(Math.floor(x-c.x),Math.floor(y-c.y),tile+1,tile+1);const n=hash(Math.floor(x/tile),Math.floor(y/tile));ctx.fillStyle=n>.5?'#ffffff0a':'#142a1b0d';ctx.fillRect(Math.floor(x-c.x+8+n*42),Math.floor(y-c.y+12+n*31),5,5);}
    ctx.fillStyle='#216b92';ctx.fillRect(water.x-c.x,-c.y,water.width,WORLD_H);for(let y=Math.floor(c.y/48)*48;y<c.y+H+48;y+=48){ctx.fillStyle='#54bada88';ctx.fillRect(water.x-c.x+20+Math.sin(y*.02)*12,y-c.y,85,5);ctx.fillRect(water.x-c.x+180+Math.cos(y*.017)*15,y-c.y+20,105,5);}
    ctx.fillStyle='#b79762';for(const r of roads)ctx.fillRect(r.x-c.x,r.y-c.y,r.w,r.h);
    ctx.fillStyle='#736449';ctx.fillRect(bridge.x-c.x,bridge.y-c.y,bridge.w,bridge.h);for(let x=bridge.x;x<bridge.x+bridge.w;x+=35){ctx.fillStyle=x%70?'#9d895d':'#806d4f';ctx.fillRect(x-c.x,bridge.y-c.y,31,bridge.h);}
  }
  function drawWorldObjects(){
    const c=state.camera;
    for(const d of decorations){if(!visible(d.x,d.y))continue;const s=worldToScreen(d.x,d.y);atlas(art.terrain,d.type,5,5,s.x-60,s.y-70,120,110);}
    for(const h of houses){if(!visible(h.x+h.w/2,h.y+h.h/2,250))continue;const s=worldToScreen(h.x,h.y);atlas(art.landmarks,h.art,5,4,s.x,s.y,h.w,h.h);label(h.label,s.x+h.w/2,s.y-4,'#fff5bd');}
    for(const l of landmarks){if(!visible(l.x+l.w/2,l.y+l.h/2,300))continue;const s=worldToScreen(l.x,l.y);atlas(art.landmarks,l.art,5,4,s.x,s.y,l.w,l.h);label(l.label,s.x+l.w/2,s.y-4,l.art===15?'#e397ff':'#ffd979');}
    for(const chest of chests){if(state.opened.has(chest.id)||!visible(chest.x,chest.y))continue;const s=worldToScreen(chest.x,chest.y);ctx.save();ctx.translate(0,Math.sin(state.time*2+chest.x)*3);atlas(art.landmarks,10,5,4,s.x-42,s.y-45,84,76);ctx.restore();if(dist(state.player,chest)<95)prompt('OPEN',s.x,s.y+48);}
    drawQuestMarkers();
  }
  function drawQuestMarkers(){let marks=[];if(state.quest===0||state.quest===3)marks=[npcs[0]];else if(state.quest===1)marks=campCenters.filter(c=>enemies.some(e=>e.camp===c.id&&e.shard&&!e.dead));else if(state.quest===2)marks=[{x:4520,y:1780}];for(const m of marks){if(!visible(m.x,m.y))continue;const s=worldToScreen(m.x,m.y),bob=Math.sin(state.time*4)*5;ctx.fillStyle='#ffe35c';ctx.beginPath();ctx.moveTo(s.x,s.y-105+bob);ctx.lineTo(s.x-15,s.y-130+bob);ctx.lineTo(s.x+15,s.y-130+bob);ctx.closePath();ctx.fill();text('!',s.x,s.y-140+bob,32,'#fff36a','center',5);}}
  function drawEntities(){
    const all=[];for(const n of npcs)if(visible(n.x,n.y))all.push({y:n.y,type:'npc',o:n});for(const e of enemies)if(!e.dead&&visible(e.x,e.y))all.push({y:e.y,type:'enemy',o:e});all.push({y:state.player.y,type:'player',o:state.player});all.sort((a,b)=>a.y-b.y);
    for(const a of all){if(a.type==='npc')drawNpc(a.o);else if(a.type==='enemy')drawEnemy(a.o);else drawPlayer();}
    for(const l of state.loot){if(l.type==='shard'||l.life>0){const s=worldToScreen(l.x,l.y);atlas(art.gear,l.type==='shard'?17:l.type==='potion'?22:8,5,5,s.x-23,s.y-25,46,46);}}
    for(const b of state.projectiles){const s=worldToScreen(b.x,b.y);ctx.fillStyle='#b66cff';ctx.beginPath();ctx.arc(s.x,s.y,b.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#f1c1ff';ctx.lineWidth=4;ctx.stroke();}
  }
  function shadow(x,y,r){ctx.fillStyle='#10131c66';ctx.beginPath();ctx.ellipse(x,y,r,r*.35,0,0,Math.PI*2);ctx.fill();}
  function drawPlayer(){const p=state.player,s=worldToScreen(p.x,p.y),bob=Math.sin(state.time*12)*Math.min(2,Math.hypot(p.vx,p.vy)/80);shadow(s.x,s.y+25,25);atlas(art.npcs,9,4,4,s.x-43,s.y-64+bob,86,92,p.facing<0,p.invuln>0&&Math.floor(state.time*14)%2?0.45:1);if(p.attack>0){const a=getAim(),angle=Math.atan2(a.y,a.x),progress=1-p.attack/.34;ctx.save();ctx.translate(s.x,s.y);ctx.rotate(angle-Math.PI*.65+progress*Math.PI*1.3);ctx.strokeStyle='#fff3a3';ctx.lineWidth=14;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,0,70,-.18,.18);ctx.stroke();ctx.strokeStyle='#71dff4';ctx.lineWidth=5;ctx.stroke();ctx.restore();}}
  function drawNpc(n){const s=worldToScreen(n.x,n.y),bob=Math.sin(state.time*3+n.x)*1.5;shadow(s.x,s.y+22,23);atlas(art.npcs,n.art,4,4,s.x-40,s.y-62+bob,80,86);label(n.name,s.x,s.y-66,n.color);if(dist(state.player,n)<100)prompt('TALK',s.x,s.y+48);}
  function drawEnemy(e){const s=worldToScreen(e.x,e.y),size=e.boss?140:90;shadow(s.x,s.y+e.r*.7,e.r*.75);ctx.save();if(e.hurt>0)ctx.filter='brightness(2.2) saturate(.2)';atlas(art.monsters,e.art,4,4,s.x-size/2,s.y-size*.62,size,size);ctx.restore();if(e.hp<e.maxHp||dist(state.player,e)<300){bar(s.x-size*.35,s.y-size*.58-12,size*.7,9,e.hp/e.maxHp,e.boss?'#a963ff':'#e96352');}if(e.boss)label('SHADOW WARDEN',s.x,s.y-size*.65-20,'#dba2ff');}
  function drawEffects(){const c=state.camera;for(const p of state.particles){ctx.globalAlpha=Math.min(1,p.life*3);ctx.fillStyle=p.color;ctx.fillRect(p.x-c.x-p.size/2,p.y-c.y-p.size/2,p.size,p.size);}ctx.globalAlpha=1;for(const f of state.floaters){const s=worldToScreen(f.x,f.y);ctx.globalAlpha=Math.min(1,f.life*2);text(f.text,s.x,s.y,20,f.color,'center');}ctx.globalAlpha=1;}
  function label(t,x,y,color){text(t,x,y,14,color,'center',3);}
  function prompt(t,x,y){ctx.fillStyle='#15162ee8';roundRect(x-47,y-15,94,28,7,true);ctx.strokeStyle='#fff3be';ctx.lineWidth=3;roundRect(x-47,y-15,94,28,7,false,true);text(`E / ✕  ${t}`,x,y+5,12,'#fff8dd','center',2);}
  function text(t,x,y,size=20,color='#fff',align='left',stroke=4){ctx.font=`900 ${size}px system-ui, sans-serif`;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.lineJoin='round';if(stroke){ctx.strokeStyle='#151326';ctx.lineWidth=stroke;ctx.strokeText(t,x,y);}ctx.fillStyle=color;ctx.fillText(t,x,y);}
  function bar(x,y,w,h,p,color,bg='#201a32'){ctx.fillStyle=bg;roundRect(x,y,w,h,3,true);ctx.fillStyle=color;roundRect(x+2,y+2,(w-4)*clamp(p,0,1),h-4,2,true);ctx.strokeStyle='#fff3cb';ctx.lineWidth=2;roundRect(x,y,w,h,3,false,true);}
  function roundRect(x,y,w,h,r,fill=false,stroke=false){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill)ctx.fill();if(stroke)ctx.stroke();}

  function drawHud(){
    const p=state.player;
    ctx.fillStyle='#151429e8';roundRect(18,16,355,100,12,true);ctx.strokeStyle='#fff1bc';ctx.lineWidth=4;roundRect(18,16,355,100,12,false,true);
    text(`LV ${p.level}`,34,49,22,'#ffe061');bar(105,31,245,22,p.hp/p.maxHp,'#e85455');text(`${Math.ceil(p.hp)} / ${p.maxHp}`,227,48,14,'#fff','center',3);
    text('XP',34,87,16,'#78eaff');bar(78,71,272,17,p.xp/p.nextXp,'#45ccea');text(`${p.xp} / ${p.nextXp}`,214,85,12,'#fff','center',2);
    ctx.fillStyle='#151429e8';roundRect(W-285,16,267,100,12,true);ctx.strokeStyle='#fff1bc';ctx.lineWidth=4;roundRect(W-285,16,267,100,12,false,true);
    atlas(art.gear,8,5,5,W-270,27,38,38);text(`${p.gold}`,W-222,57,23,'#ffd85f');atlas(art.gear,22,5,5,W-145,26,38,38);text(`${p.potions}`,W-98,57,23,'#75efa6');
    text('QUEST',W-265,86,13,'#83eaff');text(currentQuestText(),W-265,106,13,'#fff4cd');
    ctx.fillStyle='#151429d9';roundRect(18,H-72,470,54,11,true);ctx.strokeStyle='#e9deb7';ctx.lineWidth=3;roundRect(18,H-72,470,54,11,false,true);text('MOVE  WASD / LEFT STICK',34,H-40,14,'#fff2c9');text('ATTACK  SPACE / □',253,H-40,14,'#ffcf6d');
    ctx.fillStyle='#151429d9';roundRect(W-382,H-72,364,54,11,true);ctx.strokeStyle='#e9deb7';ctx.lineWidth=3;roundRect(W-382,H-72,364,54,11,false,true);text('E / ✕  USE',W-364,H-40,14,'#7fe6ff');text('B / △  BAG',W-240,H-40,14,'#a4f0a7');text('M  MAP',W-112,H-40,14,'#ffe072');
  }
  function drawDialogue(){const d=state.dialogue;if(!d)return;ctx.fillStyle='#0e1025ee';roundRect(95,H-230,W-190,180,15,true);ctx.strokeStyle='#ffe7a0';ctx.lineWidth=6;roundRect(95,H-230,W-190,180,15,false,true);atlas(art.npcs,d.portrait||0,4,4,120,H-214,130,140);text(d.name.toUpperCase(),275,H-191,25,'#ffe06a');wrap(d.lines[state.dialogueIndex],275,H-153,W-420,26,22,'#fffbed');text('E / ✕  CONTINUE',W-135,H-72,15,'#75eaff','right');}
  function wrap(str,x,y,maxWidth,lineHeight,size,color){const words=str.split(' ');let line='',yy=y;for(const word of words){const test=line+word+' ';ctx.font=`800 ${size}px system-ui`;if(ctx.measureText(test).width>maxWidth&&line){text(line,x,yy,size,color);line=word+' ';yy+=lineHeight;}else line=test;}text(line,x,yy,size,color);}
  function drawInventory(){ctx.fillStyle='#080b18dd';ctx.fillRect(0,0,W,H);ctx.fillStyle='#242445';roundRect(180,95,W-360,H-190,18,true);ctx.strokeStyle='#ffe39a';ctx.lineWidth=7;roundRect(180,95,W-360,H-190,18,false,true);text('ADVENTURE BAG',W/2,145,34,'#ffe16a','center');drawItemCard(250,190,0,'LANTERN BLADE',`Power ${26+state.player.level*4+state.player.weapon*11}`,state.player.weapon?'UPGRADED':'STANDARD');drawItemCard(535,190,22,'HEALING POTION',`You have ${state.player.potions}`,'PRESS H / R1 TO USE');drawItemCard(820,190,17,'MOONSHARDS',`${state.shards} of 3 found`,'QUEST ITEM');text('B / △  CLOSE BAG',W/2,H-125,18,'#8beaff','center');}
  function drawItemCard(x,y,index,name,count,info){ctx.fillStyle='#33365a';roundRect(x,y,220,310,13,true);ctx.strokeStyle='#a4b7d0';ctx.lineWidth=4;roundRect(x,y,220,310,13,false,true);atlas(art.gear,index,5,5,x+36,y+25,148,148);text(name,x+110,y+203,16,'#fff3bf','center');text(count,x+110,y+239,18,'#fff','center');text(info,x+110,y+275,12,'#7fe5f5','center');}
  function drawMap(){ctx.fillStyle='#090b18ed';ctx.fillRect(0,0,W,H);ctx.fillStyle='#d7c38b';roundRect(110,55,W-220,H-110,12,true);ctx.strokeStyle='#3b2530';ctx.lineWidth=9;roundRect(110,55,W-220,H-110,12,false,true);const mx=145,my=90,mw=W-290,mh=H-180,sx=mw/WORLD_W,sy=mh/WORLD_H;ctx.save();ctx.beginPath();ctx.rect(mx,my,mw,mh);ctx.clip();ctx.fillStyle='#518b4b';ctx.fillRect(mx,my,mw,mh);ctx.fillStyle='#2c78a0';ctx.fillRect(mx+water.x*sx,my,water.width*sx,mh);ctx.fillStyle='#b29463';for(const r of roads)ctx.fillRect(mx+r.x*sx,my+r.y*sy,Math.max(3,r.w*sx),Math.max(3,r.h*sy));for(const camp of campCenters){ctx.fillStyle='#c74645';ctx.beginPath();ctx.arc(mx+camp.x*sx,my+camp.y*sy,9,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#8f42ad';ctx.fillRect(mx+4370*sx,my+1730*sy,60,55);ctx.fillStyle='#ffe65d';ctx.beginPath();ctx.arc(mx+state.player.x*sx,my+state.player.y*sy,9,0,Math.PI*2);ctx.fill();ctx.restore();text('WORLD MAP',W/2,85,29,'#402b35','center',0);text('● YOU',155,H-75,14,'#5a3433', 'left',0);text('● ENEMY CAMP',245,H-75,14,'#c73d3d','left',0);text('■ BLACK CROWN KEEP',420,H-75,14,'#762d92','left',0);text('M / SELECT  CLOSE',W-145,H-75,14,'#3a2730','right',0);}
  function drawDeath(){ctx.fillStyle='#120b18dc';ctx.fillRect(0,0,W,H);text('YOUR LANTERN WENT OUT',W/2,H/2-35,47,'#ff8b78','center');text('Press E, X, or Cross to return to the village',W/2,H/2+24,22,'#fff1c7','center');text('You keep your gear, but lose up to 25 gold.',W/2,H/2+62,16,'#cfc6d6','center');}
  function drawEnding(){ctx.fillStyle='#10132be8';ctx.fillRect(0,0,W,H);ctx.fillStyle='#293c63';roundRect(W/2-380,H/2-210,760,420,20,true);ctx.strokeStyle='#ffe36d';ctx.lineWidth=8;roundRect(W/2-380,H/2-210,760,420,20,false,true);text('REALM SAVED!',W/2,H/2-115,54,'#ffe36d','center');text('YOU ARE THE LANTERN KEEPER',W/2,H/2-57,27,'#81ebff','center');text(`${state.stats.enemies} enemies defeated   •   ${state.stats.chests} chests opened`,W/2,H/2+2,21,'#fff','center');text('+500 gold   +500 XP',W/2,H/2+51,25,'#86f1a7','center');text('Press E, X, or Cross to keep exploring',W/2,H/2+131,18,'#fff2c9','center');}

  playButton.addEventListener('click',()=>{loadSave();makeEnemies();state.camera.x=clamp(state.player.x-W/2,0,WORLD_W-W);state.camera.y=clamp(state.player.y-H/2,0,WORLD_H-H);started=true;state.mode='game';loading.classList.add('hidden');announce(state.quest?'Adventure restored.':'Find Elder Luma in the village square.','#ffe271');});
  document.addEventListener('keydown',e=>{if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.code==='Space')actionAttack();if(e.code==='KeyE'||e.code==='Enter')actionInteract();if(e.code==='ShiftLeft'||e.code==='KeyC')dash();if(e.code==='KeyB'||e.code==='KeyI')toggleInventory();if(e.code==='KeyM')toggleMap();if(e.code==='Escape')togglePause();if(e.code==='KeyH')usePotion();});
  document.addEventListener('keyup',e=>keys.delete(e.code));
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();mouse.x=(e.clientX-r.left)*W/r.width;mouse.y=(e.clientY-r.top)*H/r.height;});
  canvas.addEventListener('pointerdown',()=>{mouse.down=true;mouse.clicked=true;actionAttack();});canvas.addEventListener('pointerup',()=>mouse.down=false);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='game')togglePause();});
  pausePanel.addEventListener('click',e=>{const a=e.target?.dataset?.action;if(a==='resume')togglePause();if(a==='save'){save();announce('Adventure saved.','#79e7ff');togglePause();}if(a==='restart')resetGame();});
  window.addEventListener('beforeunload',save);

  function loop(now){const dt=Math.min(.033,(now-last)/1000);last=now;if(started)update(dt);draw();requestAnimationFrame(loop);}requestAnimationFrame(loop);
})();
