/*
 * console-chrome.js — the Stark-HUD presentation layer (CO-016).
 *
 * Lifted verbatim out of StrikeSim2040.html so the shell is smaller and this code is
 * covered by the syntax gate. Three self-contained, defensively try/caught IIFEs:
 *   I.   boot fade ritual + live telemetry clock + readout value-flash
 *   II.  synthesized audio engine (StrikeSimAudio) + DEFCON threat FX (StrikeSimFX)
 *   III. tactical radar scope + live C2 intel ticker, driven by AppShell view state
 *
 * Presentation ONLY: it reads window.AppShell / window.AppState and drives decorative
 * DOM. It never touches match state or the seeded RNG. Loads after the shell so those
 * globals already exist; every block no-ops safely if they do not.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */
// ── Stark-HUD overhaul: boot fade, live telemetry clock, readout FX ──
  (function(){
    try {
      var lines = [
        '▸ initializing C2 core ............. <span class="ok">OK</span>',
        '▸ preparing force packages (RED/BLUE)  <span class="ok">OK</span>',
        '▸ calibrating MIL-STD-2525 symbology  <span class="ok">OK</span>',
        '▸ readying operational map ......... <span class="ok">OK</span>',
        '▸ 3D renderer set to on-demand ...... <span class="ok">OK</span>',
        '▸ performance lifecycle armed ....... <span class="ok">OK</span>'
      ];
      // C-050: cinematic boot is first-run-only and always skippable. Returning
      // operators get a fast branded fade; reduced-motion gets near-instant.
      var bootEl = document.getElementById('boot');
      var bootReduced = window.AppShell ? AppShell.prefersReducedMotion()
        : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      var bootSeen = false; try { bootSeen = localStorage.getItem('strikesim_boot_seen') === '1'; } catch(e) {}
      var bootDwell = bootReduced ? 100 : (bootSeen ? 250 : 900);
      var logEl = document.getElementById('boot-log'), i = 0;
      if (bootReduced || bootSeen) {
        // no typing theater on repeat visits — render the log at once
        if (logEl) logEl.innerHTML = lines.map(function(l){ return '<div>' + l + '</div>'; }).join('');
      } else {
        (function nextLine(){
          if (!logEl || i >= lines.length) return;
          var d = document.createElement('div'); d.innerHTML = lines[i++];
          logEl.appendChild(d); setTimeout(nextLine, 110);
        })();
      }
      function killBoot(){
        var b = document.getElementById('boot'); if (b) b.classList.add('gone');
        try { localStorage.setItem('strikesim_boot_seen', '1'); } catch(e) {}
      }
      if (bootEl) {
        var hint = document.createElement('div'); hint.className = 'boot-skip';
        hint.textContent = 'CLICK OR PRESS ANY KEY TO SKIP';
        bootEl.appendChild(hint);
        bootEl.addEventListener('pointerdown', killBoot);
      }
      window.addEventListener('keydown', killBoot, { once: true });
      var bootStart = Date.now();
      function scheduleKill(){ setTimeout(killBoot, Math.max(0, bootDwell - (Date.now()-bootStart))); }
      if (document.readyState !== 'loading') scheduleKill(); else document.addEventListener('DOMContentLoaded', scheduleKill, { once: true });
      setTimeout(killBoot, 2000); // hard cap — the game shell never waits on visual assets

      function buildTelemetry(){
        var bar = document.getElementById('cmd-bar');
        var brand = bar && bar.querySelector('.cb-brand');
        if (!bar || !brand || document.querySelector('.cb-telemetry')) return;
        var t = document.createElement('div'); t.className = 'cb-telemetry';
        t.innerHTML = '<span class="tlm"><span class="dot"></span><b>C2 LINK</b></span>'
                    + '<span class="tlm">SECTOR <b>INDO-PAC</b></span>'
                    + '<span class="tlm"><b id="cb-clock">--:--:--</b> UTC</span>';
        brand.insertAdjacentElement('afterend', t);
        var tickClock = function(){ var el=document.getElementById('cb-clock'); if(el) el.textContent=new Date().toISOString().slice(11,19); };
        tickClock();
        if (window.AppShell) AppShell.every(1000, tickClock); else setInterval(tickClock, 1000); // pauses on hidden tab (C-050)
      }
      if (document.getElementById('cmd-bar')) buildTelemetry(); else document.addEventListener('DOMContentLoaded', buildTelemetry);

      var st = document.createElement('style');
      st.textContent = '@keyframes valFlash{0%{color:#fff;text-shadow:0 0 18px rgba(0,216,255,.95)}100%{}} .val-flash{animation:valFlash .6s ease}';
      document.head.appendChild(st);
      var obs = new MutationObserver(function(muts){
        muts.forEach(function(m){
          var n = (m.target.nodeType===3 ? m.target.parentElement : m.target);
          if (n && n.classList && n.classList.contains('result-value')) { n.classList.remove('val-flash'); void n.offsetWidth; n.classList.add('val-flash'); }
        });
      });
      document.querySelectorAll('.result-value').forEach(function(el){ obs.observe(el,{childList:true,characterData:true,subtree:true}); });
    } catch(e){ var b=document.getElementById('boot'); if(b) b.classList.add('gone'); }
  })();

// ── Stark-HUD overhaul II: synth audio engine · DEFCON threat · screen FX ──
  (function(){
    "use strict";
    try {
      var css = document.createElement('style');
      css.textContent = [
        '@keyframes fxShake{10%{transform:translate(-3px,2px)}20%{transform:translate(4px,-3px)}30%{transform:translate(-5px,1px)}40%{transform:translate(4px,3px)}50%{transform:translate(-3px,-2px)}60%{transform:translate(3px,2px)}70%{transform:translate(-2px,-1px)}80%{transform:translate(2px,1px)}100%{transform:translate(0,0)}}',
        'body.fx-shake #app{animation:fxShake .32s ease}',
        '#fx-vignette{position:fixed;inset:0;z-index:1250;pointer-events:none;opacity:0;box-shadow:inset 0 0 200px 46px rgba(255,40,40,.55);transition:opacity .25s ease}',
        'body.fx-alert #fx-vignette{opacity:1;animation:fxAlertPulse 1.1s ease-in-out infinite}',
        '@keyframes fxAlertPulse{0%,100%{opacity:.22}50%{opacity:.85}}',
        '.cb-telemetry .defcon b{font-weight:700;letter-spacing:1px}',
        '.defcon[data-lvl="5"] b{color:#51cf66;text-shadow:0 0 8px rgba(81,207,102,.6)}',
        '.defcon[data-lvl="4"] b{color:#9ad84d;text-shadow:0 0 8px rgba(154,216,77,.6)}',
        '.defcon[data-lvl="3"] b{color:#ffb000;text-shadow:0 0 10px rgba(255,176,0,.7)}',
        '.defcon[data-lvl="2"] b{color:#ff7a3c;text-shadow:0 0 12px rgba(255,122,60,.85)}',
        '.defcon[data-lvl="1"] b{color:#ff3b3b;text-shadow:0 0 14px rgba(255,59,59,.95);animation:liveBlink 1s steps(1) infinite}',
        '.cb-audio{cursor:pointer;background:transparent;border:0;color:#7fa6c2;font-family:var(--mono);font-size:14px;padding:0 4px;clip-path:none}',
        '.cb-audio:hover{color:var(--cyan);box-shadow:none;background:transparent;transform:none}'
      ].join('\n');
      document.head.appendChild(css);
      var vig = document.createElement('div'); vig.id='fx-vignette'; document.body.appendChild(vig);

      // ---- Synthesized audio engine (offline, zero asset files) ----
      var AC=null, master=null, armed=false;
      var muted=(function(){ try{ return localStorage.getItem('strikesim_muted')==='1'; }catch(e){ return false; } })();
      function arm(){
        if(armed) return;
        try {
          AC=new (window.AudioContext||window.webkitAudioContext)();
          master=AC.createGain(); master.gain.value=muted?0:0.5; master.connect(AC.destination);
          armed=true; if(AC.state==='suspended') AC.resume();
          Audio.boot();
        } catch(e){ armed=false; }
      }
      function tone(freq,t0,dur,type,peak,glideTo){
        if(!armed||!AC) return;
        var o=AC.createOscillator(), g=AC.createGain();
        o.type=type||'sine'; o.frequency.setValueAtTime(freq,t0);
        if(glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,glideTo),t0+dur);
        g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(peak||0.25,t0+0.012);
        g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0+dur+0.02);
      }
      function noise(t0,dur,peak,lp){
        if(!armed||!AC) return;
        var n=Math.floor(AC.sampleRate*dur), buf=AC.createBuffer(1,n,AC.sampleRate), d=buf.getChannelData(0);
        for(var i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
        var src=AC.createBufferSource(); src.buffer=buf;
        var f=AC.createBiquadFilter(); f.type='lowpass'; f.frequency.value=lp||1200;
        var g=AC.createGain(); g.gain.setValueAtTime(peak||0.3,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
        src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0+dur);
      }
      var Audio = window.StrikeSimAudio = {
        isMuted:function(){ return muted; },
        setMuted:function(m){ muted=!!m; try{localStorage.setItem('strikesim_muted',muted?'1':'0');}catch(e){} if(master) master.gain.value=muted?0:0.5; updateAudioBtn(); },
        toggleMute:function(){ this.setMuted(!muted); },
        click:function(){ if(!armed) return; tone(880,AC.currentTime,0.06,'square',0.05); },
        boot:function(){ if(!armed) return; var t=AC.currentTime; tone(150,t,0.7,'sawtooth',0.16,760); tone(300,t+0.05,0.6,'sine',0.10,980); noise(t,0.5,0.09,2400); },
        strike:function(kind){ if(!armed) return; var t=AC.currentTime;
          if(kind==='kill'||kind==='cascade'){ tone(220,t,0.5,'sine',0.38,40); tone(90,t,0.55,'sine',0.28,30); noise(t,0.45,0.45,900); }
          else { tone(1200,t,0.14,'square',0.16,300); noise(t,0.12,0.16,3000); } },
        alert:function(level){ if(!armed) return; var t=AC.currentTime, f=(level<=1?660:520);
          tone(f,t,0.28,'sawtooth',0.2,f); tone(f*0.75,t+0.3,0.28,'sawtooth',0.2,f*0.75); }
      };

      // ---- Global FX bus + DEFCON threat model ----
      var threat=5, threatVal=0, lastDefcon=5;
      function defconFromVal(v){ return Math.max(1, 5-Math.round(v*4)); }
      function renderDefcon(){ var el=document.getElementById('cb-defcon'); if(!el) return; el.setAttribute('data-lvl',String(threat)); var b=el.querySelector('b'); if(b) b.textContent=String(threat); document.body.classList.toggle('fx-alert', threat<=2); }
      function setThreatVal(v){ threatVal=Math.max(0,Math.min(1,v)); var nd=defconFromVal(threatVal); if(nd!==threat){ threat=nd; renderDefcon(); if(threat<lastDefcon && threat<=2) Audio.alert(threat); lastDefcon=threat; } }
      function screenShake(){ document.body.classList.remove('fx-shake'); void document.body.offsetWidth; document.body.classList.add('fx-shake'); setTimeout(function(){document.body.classList.remove('fx-shake');},340); }
      window.StrikeSimFX = {
        onStrike:function(kind){ try{ Audio.strike(kind); if(kind==='kill'||kind==='cascade') screenShake(); setThreatVal(threatVal+((kind==='kill'||kind==='cascade')?0.22:0.09)); }catch(e){} },
        setDefcon:function(n){ n=Math.max(1,Math.min(5,n|0)); setThreatVal((5-n)/4); },
        alert:function(){ setThreatVal(1); },
        screenShake:screenShake
      };
      var threatDecay = function(){ if(threatVal>0) setThreatVal(threatVal-0.05); };
      if (window.AppShell) AppShell.every(1300, threatDecay); else setInterval(threatDecay, 1300); // calm decays; pauses on hidden tab (C-050)

      // ---- DEFCON chip + sound toggle into the telemetry cluster ----
      function updateAudioBtn(){ var b=document.getElementById('cb-audio-btn'); if(b) b.textContent=muted?'🔇':'🔊'; }
      function buildExtras(){
        var tel=document.querySelector('.cb-telemetry'); if(!tel||document.getElementById('cb-defcon')) return false;
        var d=document.createElement('span'); d.className='tlm defcon'; d.id='cb-defcon'; d.setAttribute('data-lvl','5'); d.innerHTML='DEFCON <b>5</b>'; tel.insertBefore(d, tel.firstChild);
        var btn=document.createElement('button'); btn.type='button'; btn.className='cb-audio'; btn.id='cb-audio-btn'; btn.title='Toggle sound'; tel.appendChild(btn);
        btn.addEventListener('click', function(ev){ ev.stopPropagation(); arm(); Audio.toggleMute(); });
        updateAudioBtn(); renderDefcon(); return true;
      }
      if(!buildExtras()){ var tries=0, iv=setInterval(function(){ if(buildExtras()||++tries>50) clearInterval(iv); },120); }

      // ---- arm audio on first gesture; subtle UI click blips ----
      window.addEventListener('pointerdown', arm);
      window.addEventListener('keydown', arm);
      var lastClick=0;
      document.addEventListener('click', function(e){ var t=e.target; if(t && t.closest && t.closest('button, .cb-switch button, .left-actions button, .tab')){ var now=Date.now(); if(now-lastClick>60){ lastClick=now; Audio.click(); } } }, true);
    } catch(e){ /* FX layer must never break the app */ }
  })();

// ── Stark-HUD overhaul III: tactical radar scope + live C2 intel ticker ──
  (function(){
    "use strict";
    try {
      var css=document.createElement('style');
      css.textContent=[
        '#hud-radar{position:fixed;top:calc(var(--bar-h) + 14px);left:calc(var(--left-w, 340px) + 12px);width:150px;height:170px;z-index:1180;pointer-events:none;font-family:var(--mono);transition:left .2s ease}',
        '#hud-radar canvas{display:block;filter:drop-shadow(0 0 9px rgba(0,216,255,.28))}',
        '#hud-radar .hr-label{margin-top:3px;text-align:center;font-size:9px;letter-spacing:2.5px;color:#6f93ad}',
        '#hud-ticker{position:fixed;left:calc(var(--left-w, 340px) + 12px);right:var(--side-width);bottom:0;height:26px;z-index:1180;pointer-events:none;display:flex;align-items:center;overflow:hidden;background:linear-gradient(180deg,rgba(6,13,20,0),rgba(5,11,18,.86));border-top:1px solid var(--glass-brd);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:var(--mono);font-size:11px;transition:left .2s ease}',
        '#hud-ticker .ht-tag{flex:0 0 auto;padding:0 12px 0 10px;height:100%;display:flex;align-items:center;color:#04121b;background:linear-gradient(90deg,var(--amber),#ffd36b);font-weight:700;letter-spacing:1.5px;clip-path:polygon(0 0,100% 0,calc(100% - 11px) 100%,0 100%)}',
        '#hud-ticker .ht-view{flex:1 1 auto;overflow:hidden;position:relative;height:100%}',
        '#hud-ticker .ht-track{position:absolute;top:0;left:0;white-space:nowrap;display:inline-flex;align-items:center;height:100%;will-change:transform;animation:tickerScroll 42s linear infinite}',
        '#hud-ticker .ht-item{padding:0 4px;color:#bfe0f2}',
        '#hud-ticker .ht-sep{padding:0 12px;color:var(--cyan);opacity:.55}',
        '@keyframes tickerScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
        '@media (prefers-reduced-motion: reduce){#hud-ticker .ht-track{animation:none}}',
        'html.cin-rm #hud-ticker .ht-track{animation:none}',
        'html.cin-perf #hud-radar canvas{filter:none}',
        'html.cin-perf #hud-ticker{-webkit-backdrop-filter:none;backdrop-filter:none}',
        'html.cin-perf #hud-ticker .ht-track{animation:none;transform:none;will-change:auto}'
      ].join('\n');
      document.head.appendChild(css);

      // ---- Tactical radar scope -------------------------------------------------
      var radarWrap=document.createElement('div'); radarWrap.id='hud-radar';
      radarWrap.innerHTML='<canvas width="150" height="150"></canvas><div class="hr-label">TACTICAL SCAN</div>';
      document.body.appendChild(radarWrap);
      // C-032: the scope's loop is owned by the shell lifecycle — it runs only while
      // a view that shows the radar is active AND the tab is visible. Reduced motion
      // drops to a static 1 Hz picture with no sweep.
      var rAng=0, radarOn=false, radarTimer=0, radarRaf=0, radarPaints=0;
      function radarNodes(){ try{ var g=window.AppState&&AppState.activeGraph&&AppState.activeGraph(); return (g&&g.nodes)||[]; }catch(e){ return []; } }
      function radarReduced(){ return window.AppShell ? AppShell.prefersReducedMotion() : false; }
      function radarLight(){ return radarReduced() || !!(window.AppShell && AppShell.state.perfMode); }
      function paintRadar(){
        if(!radarOn) return;
        radarPaints++;
        var reduced=radarLight();
        var wrap=document.getElementById('hud-radar');
        var cv=wrap&&wrap.querySelector('canvas'); var ctx=cv&&cv.getContext('2d');
        if(!ctx){ scheduleRadar(); return; }
        var cx=75,cy=75,R=66;
        if(!reduced){ rAng+=0.045; if(rAng>Math.PI*2) rAng-=Math.PI*2; }
        ctx.clearRect(0,0,150,150);
        ctx.fillStyle='rgba(4,12,19,0.5)'; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(0,216,255,0.2)'; ctx.lineWidth=1;
        [0.33,0.66,1].forEach(function(f){ ctx.beginPath(); ctx.arc(cx,cy,R*f,0,Math.PI*2); ctx.stroke(); });
        ctx.beginPath(); ctx.moveTo(cx-R,cy); ctx.lineTo(cx+R,cy); ctx.moveTo(cx,cy-R); ctx.lineTo(cx,cy+R); ctx.stroke();
        var ns=radarNodes();
        if(ns.length){
          var lats=[],lons=[]; ns.forEach(function(n){ if(n.lat!=null&&n.lon!=null){ lats.push(+n.lat); lons.push(+n.lon);} });
          if(lats.length){
            var miA=Math.min.apply(null,lats),maA=Math.max.apply(null,lats),miO=Math.min.apply(null,lons),maO=Math.max.apply(null,lons);
            var spA=(maA-miA)||1, spO=(maO-miO)||1;
            ns.forEach(function(n){ if(n.lat==null||n.lon==null) return;
              var nx=((+n.lon-miO)/spO)*2-1, ny=((+n.lat-miA)/spA)*2-1;
              var x=cx+nx*R*0.86, y=cy-ny*R*0.86;
              var ping=0;
              if(!reduced){
                var na=Math.atan2(y-cy,x-cx); if(na<0) na+=Math.PI*2;
                var diff=Math.abs(((rAng-na+Math.PI*3)%(Math.PI*2))-Math.PI); ping=Math.max(0,1-diff*1.5);
              }
              var tm=(n.team||'').toLowerCase();
              var col=tm==='blue'?'56,189,248':tm==='red'?'255,77,94':tm==='green'?'81,207,102':'255,212,59';
              ctx.fillStyle='rgba('+col+','+(reduced?'0.75':(0.32+ping*0.68).toFixed(2))+')';
              ctx.beginPath(); ctx.arc(x,y,reduced?2.2:(1.5+ping*2.6),0,Math.PI*2); ctx.fill();
            });
          }
        }
        if(!reduced){
          ctx.save(); ctx.translate(cx,cy); ctx.rotate(rAng);
          var grad=ctx.createLinearGradient(0,0,R,0); grad.addColorStop(0,'rgba(0,216,255,0)'); grad.addColorStop(1,'rgba(0,216,255,0.3)');
          ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,R,-0.4,0); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
          ctx.strokeStyle='rgba(0,216,255,0.8)'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(R,0); ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle='rgba(0,216,255,0.5)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.stroke();
        scheduleRadar();
      }
      function scheduleRadar(){
        if(!radarOn) return;
        radarTimer=setTimeout(function(){ radarTimer=0; radarRaf=requestAnimationFrame(paintRadar); }, radarLight()?1000:33);
      }
      function startRadar(){ if(radarOn) return; radarOn=true; paintRadar(); }
      function stopRadar(){
        radarOn=false;
        if(radarTimer){ clearTimeout(radarTimer); radarTimer=0; }
        if(radarRaf){ cancelAnimationFrame(radarRaf); radarRaf=0; }
      }
      function syncRadar(){
        var s=window.AppShell?AppShell.state:{view:'3d',hidden:document.hidden};
        var wants=(s.view==='3d'||s.view==='map')&&!s.hidden&&!s.overlayOpen;
        if(wants) startRadar(); else stopRadar();
      }

      // ---- Live C2 intel ticker -------------------------------------------------
      var ticker=document.createElement('div'); ticker.id='hud-ticker';
      ticker.innerHTML='<div class="ht-tag">LIVE INTEL</div><div class="ht-view"><div class="ht-track" id="ht-track"></div></div>';
      document.body.appendChild(ticker);
      var feed=[], tickerOn=false, tickerTimer=0, tickerRenders=0;
      function esc(s){ return String(s).replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); }
      function ambient(){
        var counts=((document.getElementById('counts')||{}).textContent||'').trim();
        var dcEl=document.getElementById('cb-defcon'); var dc=dcEl&&dcEl.getAttribute?dcEl.getAttribute('data-lvl'):'5';
        return ['SECTOR INDO-PAC // WATCH STANDING', counts?('FORCE LAYDOWN '+counts):'FORCE LAYDOWN NOMINAL', 'THREAT POSTURE DEFCON '+dc, 'C2 DATALINK STABLE', 'ISR FEED LIVE'];
      }
      function renderTrack(){
        if(!tickerOn) return;
        tickerRenders++;
        var tr=document.getElementById('ht-track'); if(!tr) return;
        var items=ambient().concat(feed);
        var html=items.map(function(s){ return '<span class="ht-item">&#9656; '+esc(s)+'</span>'; }).join('<span class="ht-sep">//</span>');
        tr.innerHTML=html+'<span class="ht-sep">//</span>'+html;
      }
      function scheduleTicker(){
        if(!tickerOn) return;
        var slow=!!(window.AppShell&&AppShell.state.perfMode);
        tickerTimer=setTimeout(function(){ tickerTimer=0; if(!tickerOn) return; renderTrack(); scheduleTicker(); },slow?12000:6000);
      }
      function startTicker(){ if(tickerOn) return; tickerOn=true; renderTrack(); scheduleTicker(); }
      function stopTicker(){ tickerOn=false; if(tickerTimer){ clearTimeout(tickerTimer); tickerTimer=0; } }
      function syncTicker(){
        var s=window.AppShell?AppShell.state:{view:'3d',hidden:document.hidden,overlayOpen:false};
        if(s.view==='3d'&&!s.hidden&&!s.overlayOpen) startTicker(); else stopTicker();
      }
      function pushFeed(t){ t=(t||'').replace(/\s+/g,' ').trim(); if(!t) return; feed.unshift(t.slice(0,90)); if(feed.length>10) feed.pop(); if(tickerOn) renderTrack(); }
      var elist=document.getElementById('event-list');
      if(elist && window.MutationObserver){
        new MutationObserver(function(muts){ muts.forEach(function(m){ Array.prototype.forEach.call(m.addedNodes||[],function(nd){ if(nd && nd.nodeType===1) pushFeed(nd.textContent); }); }); }).observe(elist,{childList:true});
      }

      // ---- view-aware visibility (radar on 3D+map, ticker on 3D) ----------------
      // C-025: chrome follows AppShell state — no more setView monkey-patching.
      // updateViewStatus() publishes the canonical view; hidden/reduced-motion
      // changes re-sync the radar loop through the same subscription.
      function applyViewChrome(state){
        var view=state.view;
        var r=document.getElementById('hud-radar'), t=document.getElementById('hud-ticker');
        if(r) r.style.display=((view==='map'||view==='3d')&&!state.overlayOpen)?'block':'none';
        if(t) t.style.display=(view==='3d'&&!state.overlayOpen)?'flex':'none';
        syncRadar();
        syncTicker();
      }
      if (window.AppShell) {
        AppShell.subscribe(function(s, changed){
          if (changed.some(function(k){ return k==='view'||k==='hidden'||k==='reducedMotion'||k==='perfMode'||k==='overlayOpen'; })) applyViewChrome(s);
        });
        applyViewChrome(AppShell.state);
      } else {
        // resilience fallback (AppShell lives in this same document, so this
        // branch only runs if that script somehow failed): hook setView.
        (function hook(){ var tries=0; (function go(){ var orig=window.setView;
          if(typeof orig==='function' && !window.__ssViewHooked){ window.setView=function(v){ var rv=orig.apply(this,arguments); try{ applyViewChrome({view:v,hidden:document.hidden,overlayOpen:false}); }catch(e){} return rv; }; window.__ssViewHooked=true; applyViewChrome({view:'3d',hidden:document.hidden,overlayOpen:false}); return; }
          if(++tries<50) setTimeout(go,120); })(); })();
      }
      window.__ssAmbientLifecycle={snapshot:function(){return{radarOn:radarOn,radarPaints:radarPaints,tickerOn:tickerOn,tickerRenders:tickerRenders,perfMode:!!(window.AppShell&&AppShell.state.perfMode)};}};
    } catch(e){ /* HUD III layer must never break the app */ }
  })();
