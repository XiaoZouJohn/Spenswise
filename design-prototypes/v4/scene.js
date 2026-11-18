/* Local, deterministic pixel scenery. No images, network requests or financial data. */
(() => {
  const canvas = document.querySelector('#world')
  const c = canvas.getContext('2d', { alpha: false })
  canvas.width = 960; canvas.height = 640
  c.imageSmoothingEnabled = false
  let seed = 4711
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  const rect = (x,y,w,h,color) => { c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h)) }
  const poly = (points,color) => { c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill() }
  const line = (x,y,x2,y2,color,width=1) => {c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke()}
  const circle = (x,y,r,color) => { c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill() }
  const star = (x,y,color,s=1) => {rect(x-s,y,s*3,s,color);rect(x,y-s,s,s*3,color)}
  const cloud = (x,y,s,color) => {rect(x,y,40*s,5*s,color);rect(x+7*s,y-5*s,27*s,5*s,color);rect(x+14*s,y-9*s,13*s,5*s,color)}
  const pine = (x,y,s,palette) => {rect(x-2*s,y,4*s,22*s,palette[2]);for(let i=0;i<4;i++) {const w=(8+i*5)*s;poly([[x,y-(30-i*9)*s],[x-w,y+(i*2)*s],[x+w,y+(i*2)*s]],palette[i%2])}}
  const brickWall = (x,y,w,h,base,mortar) => {rect(x,y,w,h,base);for(let by=y;by<y+h;by+=12){line(x,by,x+w,by,mortar);for(let bx=x+(Math.floor(by/12)%2?12:0);bx<x+w;bx+=26)line(bx,by,bx,by+12,mortar)}}
  const windowLight = (x,y,w,h,frame,light) => {rect(x-3,y-3,w+6,h+6,frame);rect(x,y,w,h,light);rect(x+w/2-1,y,2,h,frame);rect(x,y+h/2-1,w,2,frame)}
  const stars=Array.from({length:120},()=>({x:random()*960,y:random()*350,s:random()>.9?2:1,phase:random()*6}))
  const flecks=Array.from({length:260},()=>({x:random()*960,y:random()*640,a:random()}))
  function astra(t) {
    rect(0,0,960,640,'#11152e');rect(0,260,960,180,'#1a2140');rect(0,367,960,90,'#242c49')
    stars.forEach(p=>{const lit=Math.sin(t*.6+p.phase)>.15;rect(p.x,p.y,p.s,p.s,lit?'#afb2ce':'#484f73');if(p.s===2&&lit)star(p.x,p.y,'#b0a0d8',1)})
    // Pixel moon and a distant orbital trail.
    for(let y=-27;y<=27;y+=3)for(let x=-27;x<=27;x+=3)if(x*x+y*y<27*27)rect(801+x,121+y,3,3,x<0?'#e6d9ba':'#bdb6b6')
    rect(790,111,8,5,'#bdb3ac');rect(807,130,10,4,'#a5a2ae');rect(808,103,5,7,'#d2c7b6')
    poly([[0,345],[85,305],[145,326],[224,272],[287,311],[371,291],[438,337],[516,265],[592,302],[658,246],[733,302],[804,266],[878,300],[960,254],[960,490],[0,490]],'#303855')
    poly([[0,397],[113,358],[228,404],[332,350],[408,384],[478,337],[584,391],[671,345],[754,385],[857,335],[960,379],[960,510],[0,510]],'#202b44')
    poly([[0,485],[130,455],[277,477],[409,435],[500,460],[602,418],[716,451],[822,424],[960,453],[960,640],[0,640]],'#141f32')
    for(let i=0;i<22;i++)pine(451+i*25,445+(i%4)*7,.7+(i%3)*.17,['#1e3544','#243e4c','#122333'])
    // Observatory on the right cliff.
    poly([[580,448],[636,425],[829,425],[891,457],[860,494],[609,489]],'#455068')
    poly([[609,489],[860,494],[831,551],[802,551],[802,580],[640,568]],'#222c40')
    rect(641,326,148,110,'#56506c');brickWall(650,333,130,103,'#49465f','#3e4056')
    rect(640,326,151,7,'#a390a2');rect(633,430,162,8,'#242b40')
    // Stepped dome.
    rect(634,303,160,23,'#7b6f91');rect(640,286,148,20,'#8e7a9a');rect(651,270,125,20,'#a58ba6');rect(668,259,91,15,'#b299b0');rect(690,251,47,10,'#c1a8bc')
    rect(709,255,8,68,'#36394f');rect(717,257,7,62,'#56506b');rect(642,318,150,8,'#c1a4b6')
    windowLight(659,352,27,42,'#252c44','#e2b18b');windowLight(744,352,22,30,'#252c44','#d9ae88');rect(706,389,24,47,'#202a40');rect(711,392,14,37,'#8b6384')
    rect(715,400,2,18,'#d7a0ad');rect(649,439,130,5,'#657089');rect(658,444,112,5,'#465369')
    // Telescope platform.
    rect(814,407,73,5,'#78829a');rect(821,411,5,35,'#394b63');rect(873,411,5,35,'#394b63')
    line(853,367,842,407,'#b8b0b9',4);line(853,367,865,407,'#b8b0b9',4)
    poly([[829,357],[878,330],[886,344],[837,371]],'#b7b3bc');poly([[829,357],[837,371],[830,375],[822,361]],'#e3d5cb');poly([[878,330],[889,324],[899,341],[886,347]],'#5d6a8c')
    rect(602,470,10,5,'#b2908f');rect(587,479,10,5,'#8b7a87');rect(572,489,10,5,'#71697e')
    // Foreground grasses and illuminated path.
    for(let i=0;i<55;i++){const x=430+i*11;rect(x,557+(i%6)*4,2,8,'#2a3d4d')}
    for(let i=0;i<5;i++){rect(566+i*41,529+i*9,3,12,'#3e4861');rect(564+i*41,526+i*9,7,4,'#d7a888')}
  }
  const wave=(t,color,region)=>{flecks.slice(0,160).forEach((p,i)=>{const x=(p.x+t*3*(i%2?1:-1)+960)%960,y=region+p.y%(640-region);rect(x,y,4+p.a*13,1,color)})}
  function port(t) {
    rect(0,0,960,640,'#b9dfdd');rect(0,287,960,353,'#89c8cd');rect(0,395,960,245,'#75b7c4');wave(t,'#afd8d7',294)
    cloud(500,108,1.3,'#e8f0d9');cloud(810,165,1.1,'#deecdb');cloud(379,182,.7,'#cfe7d8');rect(0,280,960,6,'#c1e0d9')
    // Distant pastel islands.
    poly([[419,294],[455,266],[477,267],[495,245],[542,245],[563,278],[604,296]],'#a1c9ba');poly([[811,294],[842,257],[869,257],[898,283],[938,294]],'#a0c6b7')
    rect(501,221,12,25,'#efead0');rect(498,217,18,5,'#e4a071');rect(505,210,4,7,'#697f7c')
    // Main island, angular shallow water and rock layers.
    poly([[550,330],[592,304],[722,287],[807,315],[884,363],[885,443],[820,488],[658,490],[552,446],[520,383]],'#a7d5ce')
    poly([[565,327],[619,309],[729,301],[805,325],[860,365],[857,427],[802,464],[657,467],[568,436],[543,380]],'#e9d9a9')
    poly([[565,346],[633,322],[742,319],[817,347],[843,389],[816,429],[704,447],[608,427],[566,399]],'#78a58a')
    poly([[569,400],[608,427],[704,447],[816,429],[843,389],[842,430],[805,458],[699,474],[609,449],[566,426]],'#658f7c')
    // Paths and quay.
    poly([[650,357],[666,350],[787,398],[778,411]],'#dcd0a5');poly([[699,375],[713,380],[668,441],[655,434]],'#dcd0a5')
    rect(611,437,19,90,'#a87a58');rect(608,439,25,5,'#dfb887');for(let y=449;y<526;y+=9)rect(611,y,19,2,'#825f50');rect(609,523,25,5,'#715951')
    rect(601,451,4,10,'#795c49');rect(637,451,4,10,'#795c49');rect(601,495,4,10,'#795c49');rect(637,495,4,10,'#795c49')
    // Lighthouse, stepped cylindrical form.
    rect(782,304,34,73,'#f2e7be');rect(788,304,6,73,'#fff3cf');rect(808,304,8,73,'#cbbd9b');rect(782,339,34,15,'#cf7654');rect(778,298,42,6,'#4c7580');rect(783,280,32,18,'#e6c18a');rect(788,283,6,12,'#fff0bd');rect(799,283,7,12,'#fff0bd');poly([[774,280],[799,262],[824,280]],'#b95d46');rect(797,254,3,8,'#637f7c');rect(795,357,9,20,'#537b7a')
    // Harbor house and tiled roofs.
    rect(631,338,83,61,'#f0dfb4');rect(686,338,28,61,'#ccb995');poly([[619,338],[643,309],[700,309],[724,338]],'#d17c54');poly([[643,309],[700,309],[724,338],[666,338]],'#ae6047');for(let y=315;y<337;y+=6)line(641,y,702+(y-315)*.7,y,'#e49c6d',2)
    windowLight(642,354,15,17,'#967b60','#86b9b5');windowLight(675,354,15,17,'#967b60','#86b9b5');rect(664,377,12,22,'#75847a');rect(652,400,46,4,'#d3c193')
    // A bright storehouse.
    rect(725,378,48,36,'#efe6c8');poly([[716,379],[743,356],[781,379]],'#618d99');rect(743,390,16,24,'#9c805e');rect(731,387,7,9,'#8fbac0')
    for(const [x,y,s] of [[589,359,.8],[742,328,.65],[840,386,.65],[579,403,.55],[718,422,.65]]) {rect(x,y,4,22*s,'#9a8a64');poly([[x+2,y-18*s],[x-22*s,y-2],[x-2,y+3]],'#497f73');poly([[x+2,y-18*s],[x+24*s,y-8],[x+8,y+1]],'#5f9980');poly([[x+2,y-18*s],[x+6,y-35*s],[x+14,y-13]],'#619b83')}
    // Sailboat and pennants.
    const bob=Math.round(Math.sin(t)*1.5);poly([[680,521+bob],[730,521+bob],[719,533+bob],[691,533+bob]],'#a36750');rect(704,470+bob,2,51,'#5f7474');poly([[700,478+bob],[676,516+bob],[700,516+bob]],'#fff2ce');poly([[710,485+bob],[731,516+bob],[710,516+bob]],'#da8960');rect(686,536+bob,45,1,'#a5d7d7')
    for(let i=0;i<6;i++){rect(865+i*4,487+i*3,3,2,'#e1ece0')}
    // Map-style edge ticks, to give scenery a navigational structure.
    for(let x=520;x<940;x+=40){rect(x,589,1,5,'#5893a3');if(x%80===40)rect(x,589,1,9,'#5893a3')}
    star(870,115,'#5c8c98',3);line(872,101,872,133,'#6ba4aa');line(856,117,888,117,'#6ba4aa')
  }
  function archive(t) {
    rect(0,0,960,640,'#d8bd8f');rect(0,100,960,350,'#c9ac7d');rect(0,100,960,6,'#b29163');rect(0,450,960,190,'#96734d')
    // Wallpaper in deliberately low contrast.
    for(let x=0;x<960;x+=40) {rect(x,108,1,338,'#d3b989');for(let y=130;y<440;y+=40)star(x+20,y,'#c1a373',1)}
    // Side shelves frame the central workstation.
    rect(43,158,181,286,'#654f3a');rect(50,163,167,276,'#8a6547');rect(739,158,178,286,'#654f3a');rect(746,163,164,276,'#8a6547')
    for(let shelf=0;shelf<3;shelf++){
      const y=174+shelf*84
      for(const left of [54,750]) {for(let i=0;i<10;i++){const h=39+Math.floor(random()*25),w=9+Math.floor(random()*4);const colors=['#7b5444','#b68a5b','#657b69','#bdb38a','#935747','#677474'];rect(left+i*15,y+62-h,w,h,colors[(i+shelf)%6]);rect(left+i*15+2,y+67-h,w-4,2,'#d2bf95');rect(left+i*15+2,y+52,w-4,1,'#b9a27e')}rect(left-4,y+64,164,7,'#b18a5e');rect(left-4,y+71,164,3,'#594932')}
    }
    // Back windows reveal the landscape and evening light.
    rect(259,110,442,271,'#8c6a49');rect(267,117,426,256,'#e8cd96');rect(274,124,412,242,'#a1bab0');rect(274,290,412,76,'#809c86');poly([[274,298],[335,265],[401,285],[452,257],[538,277],[595,242],[686,282],[686,366],[274,366]],'#7c947b')
    rect(274,324,412,42,'#5c7864');rect(473,120,7,250,'#ae8d62');rect(274,242,412,7,'#ae8d62');rect(265,368,433,10,'#e0c99b');cloud(541,164,1.4,'#c9d3b5');circle(611,180,18,'#f4d7a1')
    // Top shade and valance.
    rect(244,102,474,8,'#95734d');for(let i=0;i<10;i++){rect(251+i*46,111,43,15,'#99734f');rect(251+i*46,126,43,3,'#b28a5d')}
    // Wide desk with pixel trim, drawers, and a padded chair.
    poly([[174,455],[768,455],[805,484],[139,484]],'#bd9360');rect(139,484,666,12,'#d0aa77');rect(146,496,653,10,'#6c523b');rect(173,506,94,92,'#a57a50');rect(695,506,83,92,'#a57a50')
    for(let y=510;y<585;y+=25){rect(178,y,83,21,'#b88d5d');rect(210,y+8,17,3,'#70573e');rect(700,y,72,21,'#b88d5d');rect(727,y+8,17,3,'#70573e')}
    rect(365,570,227,70,'#5b624e');rect(374,562,209,12,'#7d8061');rect(385,554,187,8,'#969572');rect(365,584,9,56,'#414c3e');rect(583,584,9,56,'#414c3e')
    // Lamps, ink bottle, stacked books and potted foliage.
    rect(191,407,7,52,'#75633e');rect(175,454,41,5,'#62573b');poly([[167,404],[180,375],[211,375],[224,404]],'#e1bb68');rect(167,404,57,5,'#bb9250');rect(190,408,10,4,'#f9d790')
    rect(730,435,25,22,'#676e59');rect(734,428,17,8,'#4c584c');rect(731,431,25,2,'#8b9470')
    rect(267,442,49,7,'#876950');rect(269,437,46,5,'#c0c1a0');rect(272,430,38,6,'#9f6c51');rect(260,449,60,5,'#d2b480')
    rect(660,435,31,21,'#9a6449');rect(657,431,37,6,'#b87f59');for(let i=0;i<7;i++){const x=661+i*4;rect(x,402-(i%3)*10,3,31+(i%3)*10,'#65754e');poly([[x,412],[x-12,401-(i%2)*8],[x,399]],'#77875a');poly([[x,421],[x+13,407],[x+1,407]],'#8a965f')}
    // Ambient warm dust.
    flecks.slice(0,25).forEach((p,i)=>rect(250+p.x%450,150+(p.y+t*(i%2?1:-1))%230,1,1,'#ded2a5'))
    for(let x=0;x<960;x+=80){line(x,608,x+58,608,'#7a5a40',2)}
  }
  function moss(t) {
    rect(0,0,960,640,'#dce4d0');rect(0,164,960,476,'#d1ddc5');rect(0,377,960,263,'#bdcdb3')
    // Foggy tall forest, then brighter layered treeline.
    for(let i=0;i<19;i++){const x=i*59-20;rect(x,0,8+(i%3)*3,383,'#b6c9ae');rect(x+10,0,3,355,'#cedbc3');pine(x+3,177,.9,['#b8cbb1','#bacdb4','#b4c6a9'])}
    for(let i=0;i<17;i++)pine(375+i*41,292+(i%4)*12,1.6+(i%3)*.13,['#849f84','#96ad8c','#708c72'])
    poly([[0,420],[169,401],[346,420],[523,388],[674,398],[847,365],[960,382],[960,640],[0,640]],'#9fb797')
    // Pond and rock bank.
    poly([[492,436],[539,403],[671,393],[786,406],[856,448],[842,504],[773,542],[652,548],[546,520],[490,480]],'#b9c8a8')
    poly([[507,439],[552,415],[675,407],[779,421],[838,451],[823,492],[765,523],[650,533],[551,509],[508,478]],'#6a9d96')
    poly([[515,452],[558,429],[678,422],[786,434],[829,458],[811,486],[761,513],[654,518],[555,496]],'#81b0a1')
    for(let i=0;i<55;i++){const p=flecks[i];const x=540+p.x%240,y=438+p.y%61;rect(x+Math.sin(t*.5+i)*2,y,7+p.a*10,1,i%3?'#9ac0aa':'#b6d2b6')}
    // Main willow tree to the right.
    rect(803,224,17,198,'#777d57');rect(803,252,5,164,'#9c9a6c');poly([[803,310],[772,272],[774,258],[812,293]],'#777d57');poly([[816,290],[842,249],[850,251],[823,313]],'#777d57')
    for(let j=0;j<6;j++){const x=710+j*31,y=167+(j%3)*11;rect(x,y,70,52,'#738b59');rect(x-9,y+13,85,31,'#819a64');rect(x+5,y-11,42,18,'#91a971');for(let k=0;k<5;k++){rect(x+k*13,y+47,5,42+(k%3)*13,'#93aa70');rect(x+k*13+1,y+77,3,20,'#a8b982')}}
    // Stone path across lower terrain.
    for(let i=0;i<9;i++){const x=450+i*34,y=558-Math.sin(i*.5)*29;poly([[x,y],[x+25,y-3],[x+29,y+8],[x+4,y+12]],i%2?'#d1d1ab':'#c1c5a0');rect(x+4,y+11,24,3,'#8a9c7d')}
    // Small study hut, roof layers and lantern.
    rect(555,318,89,83,'#c4bd8c');rect(555,351,89,5,'#a5a57b');rect(630,321,14,80,'#a3a77c');poly([[540,320],[570,286],[635,286],[663,320]],'#647e69');poly([[570,286],[635,286],[663,320],[599,320]],'#516d60');rect(539,320,126,5,'#415e54');for(let y=293;y<320;y+=7)line(567,y,638+(y-293)*.6,y,'#74917a',2)
    windowLight(566,338,22,24,'#718369','#d8d5a0');rect(602,350,20,51,'#819073');rect(605,354,14,43,'#a8b18b');rect(614,373,2,3,'#d5c694');rect(548,402,105,6,'#9aab83');rect(555,409,89,5,'#8b9f7d')
    rect(649,341,2,26,'#65785e');rect(646,355,9,12,'#e1cc82');rect(647,358,7,6,'#f4e8aa')
    // Bridge and steps.
    poly([[689,473],[741,450],[786,463],[733,489]],'#adad7e');for(let i=0;i<7;i++)line(694+i*7,471-i*3,735+i*7,486-i*3,'#7f906c',2)
    line(688,465,740,442,'#72866a',3);line(737,482,789,459,'#72866a',3);for(const [x,y] of [[688,465],[714,454],[740,442],[737,482],[762,470],[789,459]])rect(x,y,2,16,'#74866a')
    // Pixel spirit, insect light, flowers, stones.
    const bob=Math.round(Math.sin(t*.8)*3);rect(719,324+bob,18,18,'#edf2c4');rect(715,329+bob,26,10,'#edf2c4');rect(722,330+bob,2,3,'#588574');rect(732,330+bob,2,3,'#588574');rect(723,341+bob,11,4,'#d3e4b2');star(754,320-bob,'#e9e9b4',1)
    for(let i=0;i<70;i++){const p=flecks[i],x=460+p.x%490,y=410+p.y%200;rect(x,y,1,5,'#7f9e74');if(i%4===0){rect(x-1,y-2,4,3,i%8?'#e4d6ad':'#c5d4af')}}
    for(const [x,y] of [[493,507],[850,521],[816,558]]){rect(x,y,21,9,'#899e86');rect(x+4,y-5,12,5,'#a5b79a')}
  }
  const world = document.body.dataset.world
  const paint = { astra, port, archive, moss }[world]
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches
  let frame=0, last=0
  function draw(ts=0) {if(ts-last>75||!frame){seed=4711;paint(paused?0:ts/1000);last=ts;frame++}if(!paused)requestAnimationFrame(draw)}
  const toggle=document.querySelector('.motion-toggle')
  const label=()=>{toggle.textContent=paused?'开启场景动态 ▷':'暂停场景动态 Ⅱ';toggle.setAttribute('aria-pressed',String(paused))}
  toggle.addEventListener('click',()=>{paused=!paused;label();if(!paused)requestAnimationFrame(draw)})
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{paused=e.matches;label();if(!paused)requestAnimationFrame(draw)})
  label();draw()
})()
