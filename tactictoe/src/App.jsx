import { useState, useEffect, useCallback, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════════
   ⚙️  SUPABASE CONFIG  — replace these two values with your own
   Get them from: supabase.com → your project → Settings → API
═══════════════════════════════════════════════════════════════════ */
const SUPABASE_URL  = "https://ifqbmteotnxrlilagygv.supabase.co";   // e.g. https://xyzxyz.supabase.co
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlmcWJtdGVvdG54cmxpbGFneWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3OTMyNzAsImV4cCI6MjA5NTM2OTI3MH0.sKufzYKKKYPNl6bp6dbRswqt3-efHtKVZ8UaYwBcEEU";

/* ═══════════════════════════════════════════════════════════════════
   SUPABASE CLIENT  (no SDK needed — plain fetch)
═══════════════════════════════════════════════════════════════════ */
const supa = {
  // ── Auth ──────────────────────────────────────────────────────
  async signUp(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method:"POST", headers:{ "Content-Type":"application/json", apikey:SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:"POST", headers:{ "Content-Type":"application/json", apikey:SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signOut(accessToken) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method:"POST", headers:{ apikey:SUPABASE_ANON, Authorization:`Bearer ${accessToken}` },
    });
  },
  async refreshSession(refreshToken) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method:"POST", headers:{ "Content-Type":"application/json", apikey:SUPABASE_ANON },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return r.json();
  },

  // ── Database ──────────────────────────────────────────────────
  _h(token) {
    return { "Content-Type":"application/json", apikey:SUPABASE_ANON, Authorization:`Bearer ${token||SUPABASE_ANON}`, Prefer:"return=representation" };
  },
  async getProfile(userId, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
      headers: this._h(token),
    });
    const d = await r.json();
    return Array.isArray(d) ? d[0] : null;
  },
  async upsertProfile(profile, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method:"POST",
      headers:{ ...this._h(token), Prefer:"resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    const d = await r.json();
    return Array.isArray(d) ? d[0] : d;
  },

  // ── Realtime shared state (game rooms, quickplay) via kv table ──
  async kvGet(key) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: this._h(null),
    });
    const d = await r.json();
    if (!Array.isArray(d)||d.length===0) return null;
    try { return JSON.parse(d[0].value); } catch { return d[0].value; }
  },
  async kvSet(key, value) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/kv`, {
      method:"POST",
      headers:{ ...this._h(null), Prefer:"resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }),
    });
    return r.ok;
  },
  async kvDel(key) {
    await fetch(`${SUPABASE_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}`, {
      method:"DELETE", headers: this._h(null),
    });
  },
  async kvList(prefix) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/kv?key=like.${encodeURIComponent(prefix+'%')}&select=key,value`, {
      headers: this._h(null),
    });
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  },
};

/* ═══════════════════════════════════════════════════════════════════
   SESSION PERSISTENCE  (localStorage for JWT tokens — safe, no
   passwords ever touch localStorage)
═══════════════════════════════════════════════════════════════════ */
const SESSION_KEY = "ttt_session";
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(_){} }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(_){ return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch(_){} }

/* ═══════════════════════════════════════════════════════════════════
   SUPABASE CONFIG CHECK  — shows setup UI when not configured
═══════════════════════════════════════════════════════════════════ */
function isConfigured() {
  return SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON !== "YOUR_SUPABASE_ANON_KEY";
}

/* ═══════════════════════════════════════════════════════════════════
   GAME LOGIC
═══════════════════════════════════════════════════════════════════ */
const X = "X", O = "O";
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(cells) {
  for (const [a,b,c] of WIN_LINES)
    if (cells[a] && cells[a]===cells[b] && cells[a]===cells[c]) return cells[a];
  return null;
}
function getBoardResult(cells) {
  const w = checkWinner(cells);
  if (w) return w;
  if (cells.every(c => c!==null)) return "draw";
  return null;
}
function initGame() {
  return {
    minorBoards: Array(9).fill(null).map(()=>Array(9).fill(null)),
    majorResults: Array(9).fill(null),
    currentPlayer: X, forcedMajor: null,
    phase: "pick_major", activeMajor: null,
    winner: null, isDraw: false, lastMove: null, moveCount: 0,
  };
}
function applyMove(game, majorIdx, minorIdx) {
  if (game.winner || game.isDraw) return game;
  const g = JSON.parse(JSON.stringify(game));
  const player = g.currentPlayer;
  g.minorBoards[majorIdx][minorIdx] = player;
  g.lastMove = { majorIdx, minorIdx, player };
  g.moveCount = (g.moveCount||0)+1;
  const minorResult = getBoardResult(g.minorBoards[majorIdx]);
  if (minorResult && !g.majorResults[majorIdx]) g.majorResults[majorIdx] = minorResult;
  const majorWinner = checkWinner(g.majorResults);
  if (majorWinner) { g.winner = majorWinner; g.phase="done"; return g; }
  if (g.majorResults.every(r=>r!==null)) {
    const xW=g.majorResults.filter(r=>r===X).length, oW=g.majorResults.filter(r=>r===O).length;
    g.winner = xW>oW?X:oW>xW?O:null; g.isDraw=!g.winner; g.phase="done"; return g;
  }
  const nextMajor = minorIdx;
  g.forcedMajor = g.majorResults[nextMajor]!==null ? null : nextMajor;
  g.currentPlayer = player===X?O:X;
  g.phase="pick_minor"; g.activeMajor=g.forcedMajor;
  return g;
}

/* ═══════════════════════════════════════════════════════════════════
   AI
═══════════════════════════════════════════════════════════════════ */
function countThreats(cells, player) {
  let t=0;
  for (const [a,b,c] of WIN_LINES) {
    const l=[cells[a],cells[b],cells[c]];
    if (l.filter(v=>v===player).length===2 && l.filter(v=>v===null).length===1) t++;
  }
  return t;
}
function boardScore(cells, player) {
  const opp = player===X?O:X;
  const result = getBoardResult(cells);
  if (result===player) return 100;
  if (result===opp) return -100;
  if (result==="draw") return -5;
  return countThreats(cells,player)*10 - countThreats(cells,opp)*8;
}
function minimaxMinor(cells, isMax, depth, alpha, beta) {
  const result = getBoardResult(cells);
  if (result===O) return 100-depth;
  if (result===X) return -(100-depth);
  if (result==="draw") return 0;
  if (depth>=6) return boardScore(cells,O)*0.1;
  const player = isMax?O:X;
  let best = isMax?-Infinity:Infinity;
  for (let i=0;i<9;i++) {
    if (cells[i]!==null) continue;
    const next=[...cells]; next[i]=player;
    const val = minimaxMinor(next,!isMax,depth+1,alpha,beta);
    if (isMax){best=Math.max(best,val);alpha=Math.max(alpha,val);}
    else{best=Math.min(best,val);beta=Math.min(beta,val);}
    if (beta<=alpha) break;
  }
  return best;
}
function scoreMoveGlobal(game, majIdx, minIdx) {
  const { minorBoards, majorResults } = game;
  let score = 0;
  const cells=[...minorBoards[majIdx]]; cells[minIdx]=O;
  const minorResult = getBoardResult(cells);
  if (minorResult===O) score+=300;
  else if (minorResult==="draw") score-=20;
  const xCells=[...minorBoards[majIdx]]; xCells[minIdx]=X;
  if (getBoardResult(xCells)===X) score+=180;
  const newMaj=[...majorResults];
  if (minorResult&&!newMaj[majIdx]) newMaj[majIdx]=minorResult;
  if (checkWinner(newMaj)===O) score+=2000;
  const xMaj=[...majorResults]; xMaj[majIdx]=X;
  if (checkWinner(xMaj)===X) score+=500;
  for (const [a,b,c] of WIN_LINES) {
    const line=[newMaj[a],newMaj[b],newMaj[c]];
    if (line.filter(v=>v===O).length===2 && line.filter(v=>v===null).length===1) score+=80;
    if (line.filter(v=>v===X).length===2 && line.filter(v=>v===null).length===1) score+=60;
  }
  const destResult = majorResults[minIdx];
  if (destResult!==null) { score+=40; } else {
    const destCells = minorBoards[minIdx];
    score -= countThreats(destCells,X)*25;
    score += countThreats(destCells,O)*10;
    for (let i=0;i<9;i++) {
      if (destCells[i]!==null) continue;
      const test=[...destCells]; test[i]=X;
      if (getBoardResult(test)===X) { score-=120; break; }
    }
  }
  const posVal=[3,2,3,2,4,2,3,2,3];
  score += posVal[minIdx]*4;
  score += boardScore(minorBoards[majIdx], O)*0.5;
  return score;
}
function getAIMove(game) {
  const { majorResults, forcedMajor, minorBoards } = game;
  const playableMajors = forcedMajor!==null
    ? [forcedMajor]
    : Array.from({length:9},(_,i)=>i).filter(i=>majorResults[i]===null);
  let best=null, bestScore=-Infinity;
  for (const majIdx of playableMajors) {
    const cells = minorBoards[majIdx];
    let winMove=null, blockMove=null;
    for (let minIdx=0;minIdx<9;minIdx++) {
      if (cells[minIdx]!==null) continue;
      const test=[...cells]; test[minIdx]=O;
      if (getBoardResult(test)===O) { winMove=minIdx; break; }
      const xTest=[...cells]; xTest[minIdx]=X;
      if (getBoardResult(xTest)===X) blockMove=minIdx;
    }
    const candidateMoves = winMove!==null ? [winMove]
      : blockMove!==null ? [blockMove, ...Array.from({length:9},(_,i)=>i).filter(i=>cells[i]===null&&i!==blockMove)]
      : Array.from({length:9},(_,i)=>i).filter(i=>cells[i]===null);
    for (const minIdx of candidateMoves.slice(0,9)) {
      if (cells[minIdx]!==null) continue;
      const score = scoreMoveGlobal(game,majIdx,minIdx);
      if (score>bestScore){ bestScore=score; best={majIdx,minIdx}; }
    }
  }
  return best;
}

/* ═══════════════════════════════════════════════════════════════════
   ELO
═══════════════════════════════════════════════════════════════════ */
const STARTING_ELO = 1200;
const GUEST_ELO_CHANGE = 16;
function calcEloChange(myElo, oppElo, result) {
  const K = myElo < 2100 ? 32 : myElo < 2400 ? 24 : 16;
  const expected = 1 / (1 + Math.pow(10, (oppElo-myElo)/400));
  return Math.round(K * (result - expected));
}
function applyEloChanges(myUser, oppUser, myResult) {
  const resultVal = myResult==="win"?1:myResult==="draw"?0.5:0;
  if (!myUser?.id) return 0;
  if (!oppUser?.id) return myResult==="win"?GUEST_ELO_CHANGE:myResult==="loss"?-GUEST_ELO_CHANGE:0;
  return calcEloChange(myUser.elo||STARTING_ELO, oppUser.elo||STARTING_ELO, resultVal);
}

/* ═══════════════════════════════════════════════════════════════════
   KV HELPERS  (game rooms + quickplay via Supabase kv table)
   Falls back to window.storage when not configured (dev mode)
═══════════════════════════════════════════════════════════════════ */
async function kvGet(key) {
  if (!isConfigured()) {
    try { const r=await window.storage.get(key,true); return r?JSON.parse(r.value):null; } catch{return null;}
  }
  return supa.kvGet(key);
}
async function kvSet(key, val) {
  if (!isConfigured()) {
    try { await window.storage.set(key,JSON.stringify(val),true); } catch{}; return;
  }
  return supa.kvSet(key, val);
}
async function kvDel(key) {
  if (!isConfigured()) {
    try { await window.storage.delete(key,true); } catch{}; return;
  }
  return supa.kvDel(key);
}
async function kvList(prefix) {
  if (!isConfigured()) {
    try { const r=await window.storage.list(prefix,true); return r?r.keys.map(k=>({key:k})):[]; } catch{return [];}
  }
  return supa.kvList(prefix);
}

async function saveRoom(rid,data){ await kvSet(`ttt:r:${rid}`,data); }
async function loadRoom(rid){ return await kvGet(`ttt:r:${rid}`); }
async function listRoomKeys(){
  const rows = await kvList("ttt:r:");
  return rows.map(r=>r.key);
}
function genId(n=5){ return Math.random().toString(36).slice(2,2+n).toUpperCase(); }

/* ═══════════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════════ */
const C={
  bg:"#0a0a10",surface:"#111118",card:"#17172a",border:"#2e2e48",
  accent:"#f0c040",accentDim:"#8a6c18",
  x:"#ff4444",xDim:"rgba(255,68,68,0.15)",
  o:"#38b4f5",oDim:"rgba(56,180,245,0.15)",
  draw:"#7a7a9a",text:"#eeeef8",muted:"#9a9ab8",
  success:"#3dba78",err:"#ff5555",
  minorBg:"#1e1e32",minorBorder:"#3a3a58",
};
const GS=`
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{background:${C.bg};color:${C.text};font-family:'Rajdhani',sans-serif;min-height:100vh;-webkit-tap-highlight-color:transparent;}
button{font-family:'Rajdhani',sans-serif;}
input{font-family:'Rajdhani',sans-serif;}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
@keyframes pop{0%{transform:scale(1);}50%{transform:scale(1.25);}100%{transform:scale(1);}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(240,192,64,0.4);}50%{box-shadow:0 0 0 10px rgba(240,192,64,0);}}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes glow{0%,100%{text-shadow:0 0 20px rgba(240,192,64,0.3);}50%{text-shadow:0 0 50px rgba(240,192,64,0.7),0 0 80px rgba(240,192,64,0.3);}}
@keyframes slideUp{from{opacity:0;transform:translateY(30px);}to{opacity:1;transform:translateY(0);}}
`;

/* ═══════════════════════════════════════════════════════════════════
   SETUP SCREEN  — shown when Supabase isn't configured yet
═══════════════════════════════════════════════════════════════════ */
function SetupScreen() {
  const sqlSteps = `-- Run this in Supabase → SQL Editor

-- 1. Profiles table (stores username, ELO, stats)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  elo integer not null default 1200,
  stats jsonb not null default \'{}\',
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "Anyone can read profiles"   on profiles for select using (true);
create policy "Anyone can insert profiles" on profiles for insert with check (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- 2. KV table (game rooms, quickplay queue — public read/write is fine,
--    game logic enforces correctness)
create table kv (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);
alter table kv enable row level security;
create policy "Public read"  on kv for select using (true);
create policy "Public write" on kv for insert with check (true);
create policy "Public update" on kv for update using (true);
create policy "Public delete" on kv for delete using (true);`;

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"clamp(20px,4vw,40px)",animation:"fadeIn 0.4s ease"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(22px,6vw,36px)",fontWeight:900,color:C.accent,animation:"glow 3s infinite"}}>TAC TIC TOE</div>
        <div style={{fontSize:12,color:C.muted,marginTop:4,letterSpacing:3}}>SETUP REQUIRED</div>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"clamp(16px,4vw,28px)"}}>
        <h2 style={{fontFamily:"'Orbitron',monospace",color:C.accent,fontSize:16,marginBottom:16}}>Connect Supabase</h2>
        <p style={{color:C.text,fontSize:14,lineHeight:1.7,marginBottom:20}}>
          This app uses <b style={{color:C.accent}}>Supabase</b> for secure authentication and data storage. It takes about 5 minutes to set up — free tier is plenty.
        </p>
        {[
          ["1","Create a free project","Go to supabase.com → New Project. Choose any name and region."],
          ["2","Run the SQL below","In your project: SQL Editor → New Query → paste the SQL below → Run."],
          ["3","Get your keys","Settings → API → copy Project URL and anon public key."],
          ["4","Add keys to the code","Open this .jsx file and replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY at the top."],
        ].map(([n,title,desc])=>(
          <div key={n} style={{display:"flex",gap:14,marginBottom:16}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:C.accent,color:C.bg,fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{n}</div>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:2}}>{title}</div>
              <div style={{fontSize:13,color:"#b8b8d0",lineHeight:1.5}}>{desc}</div>
            </div>
          </div>
        ))}
        <div style={{marginTop:20}}>
          <p style={{fontSize:11,color:C.muted,letterSpacing:1,marginBottom:8}}>SQL TO RUN IN SUPABASE</p>
          <pre style={{background:"#0a0a14",border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 16px",fontSize:11,color:"#8bc4ff",overflowX:"auto",lineHeight:1.6,whiteSpace:"pre-wrap"}}>
{sqlSteps}
          </pre>
        </div>
        <div style={{marginTop:16,padding:"12px 16px",background:"rgba(240,192,64,0.06)",border:`1px solid ${C.accentDim}`,borderRadius:8}}>
          <p style={{fontSize:12,color:C.muted,lineHeight:1.6}}>
            💡 The <b style={{color:C.accent}}>anon key</b> is safe to include in frontend code — Supabase designed it for this. The row-level security policies above ensure users can only modify their own data.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   AUTH HOOK  — manages Supabase session + profile
═══════════════════════════════════════════════════════════════════ */
function useAuth() {
  const [session, setSession] = useState(null);   // { access_token, refresh_token, user }
  const [profile, setProfile] = useState(null);   // { id, username, elo, stats }
  const [authLoading, setAuthLoading] = useState(true);
  const refreshTimer = useRef(null);

  const scheduleRefresh = useCallback((expiresIn) => {
    clearTimeout(refreshTimer.current);
    const ms = Math.max((expiresIn - 60) * 1000, 30000);
    refreshTimer.current = setTimeout(async () => {
      const saved = loadSession();
      if (!saved?.refresh_token) return;
      const data = await supa.refreshSession(saved.refresh_token);
      if (data.access_token) {
        const newSession = { ...saved, access_token: data.access_token, refresh_token: data.refresh_token||saved.refresh_token };
        saveSession(newSession);
        setSession(newSession);
        scheduleRefresh(data.expires_in || 3600);
      }
    }, ms);
  }, []);

  const loadProfile = useCallback(async (userId, token) => {
    try {
      const p = await supa.getProfile(userId, token);
      setProfile(p || null);
      return p;
    } catch(e) {
      console.error('loadProfile error:', e);
      return null;
    }
  }, []);

  // Restore session on mount
  useEffect(() => {
    async function restore() {
      const saved = loadSession();
      if (!saved?.access_token || !saved?.user) { setAuthLoading(false); return; }
      // Try to refresh immediately to validate
      const data = await supa.refreshSession(saved.refresh_token).catch(()=>null);
      if (data?.access_token) {
        const newSession = { ...saved, access_token: data.access_token, refresh_token: data.refresh_token||saved.refresh_token };
        saveSession(newSession);
        setSession(newSession);
        await loadProfile(newSession.user.id, newSession.access_token);
        scheduleRefresh(data.expires_in || 3600);
      } else if (saved.access_token) {
        // Token may still be valid, use it optimistically
        setSession(saved);
        await loadProfile(saved.user.id, saved.access_token);
      }
      setAuthLoading(false);
    }
    restore();
    return () => clearTimeout(refreshTimer.current);
  }, [loadProfile, scheduleRefresh]);

  const signUp = useCallback(async (username, password) => {
    const email = `${username.toLowerCase()}@tactictoe.app`;
    const data = await supa.signUp(email, password);
    if (data.error) return { error: data.error.message || "Registration failed." };
    if (!data.user) return { error: "Registration failed. Try a different username." };
    const token = data.session?.access_token || SUPABASE_ANON;
    await supa.upsertProfile({ id: data.user.id, username, elo: STARTING_ELO, stats: {} }, token);
    if (data.session?.access_token) {
      const sess = { access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: data.user };
      saveSession(sess);
      setSession(sess);
      const p = await loadProfile(data.user.id, data.session.access_token);
      scheduleRefresh(data.session.expires_in || 3600);
      return { profile: p };
    }
    const signInData = await supa.signIn(email, password);
    if (signInData.error) return { error: "Account created — please sign in." };
    const sess = { access_token: signInData.access_token, refresh_token: signInData.refresh_token, user: signInData.user };
    saveSession(sess);
    setSession(sess);
    const p = await loadProfile(signInData.user.id, signInData.access_token);
    scheduleRefresh(signInData.expires_in || 3600);
    return { profile: p };
  }, [loadProfile, scheduleRefresh]);

  const signIn = useCallback(async (username, password) => {
    const email = `${username.toLowerCase()}@tactictoe.app`;
    const data = await supa.signIn(email, password);
    if (data.error) return { error: data.error.message || data.error.msg || JSON.stringify(data.error) };
    if (!data.access_token) return { error: "No token returned: " + JSON.stringify(data).slice(0,120) };
    const sess = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user };
    saveSession(sess);
    setSession(sess);
    // Try to load profile; if missing, create it now (handles edge cases)
    let p = await loadProfile(data.user.id, data.access_token);
    if (!p) {
      await supa.upsertProfile({ id: data.user.id, username, elo: STARTING_ELO, stats: {} }, data.access_token);
      p = await loadProfile(data.user.id, data.access_token);
    }
    scheduleRefresh(data.expires_in || 3600);
    return { profile: p, success: true };
  }, [loadProfile, scheduleRefresh]);

  const signOut = useCallback(async () => {
    if (session?.access_token) await supa.signOut(session.access_token).catch(()=>{});
    clearSession();
    setSession(null);
    setProfile(null);
  }, [session]);

  const updateProfile = useCallback(async (updates) => {
    if (!session || !profile) return;
    const updated = { ...profile, ...updates };
    await supa.upsertProfile(updated, session.access_token);
    setProfile(updated);
    return updated;
  }, [session, profile]);

  return { session, profile, authLoading, signUp, signIn, signOut, updateProfile };
}

/* ═══════════════════════════════════════════════════════════════════
   MINOR CELL
═══════════════════════════════════════════════════════════════════ */
function MinorCell({value, onClick, canClick, isLast}) {
  const [anim,setAnim]=useState(false);
  useEffect(()=>{if(value){setAnim(true);setTimeout(()=>setAnim(false),300);}},[value]);
  return (
    <button onClick={onClick} disabled={!canClick} style={{
      width:"100%",aspectRatio:"1",
      border:`1.5px solid ${value?(value===X?"#553333":"#1a3a55"):canClick?"#4a4a70":"#252538"}`,
      borderRadius:4,
      background:isLast?"rgba(240,192,64,0.12)":value?(value===X?"rgba(255,68,68,0.08)":"rgba(56,180,245,0.08)"):canClick?"rgba(255,255,255,0.05)":C.minorBg,
      color:value===X?C.x:C.o,
      fontFamily:"'Orbitron',monospace",fontWeight:900,
      fontSize:"clamp(10px,2.5vw,18px)",
      cursor:canClick?"pointer":"default",
      transition:"background 0.15s,border-color 0.15s,transform 0.1s",
      transform:anim?"scale(1.25)":"scale(1)",
      display:"flex",alignItems:"center",justifyContent:"center",
    }}>
      {value||(canClick?<span style={{opacity:0.2,fontSize:"0.6em",color:C.muted}}>+</span>:"")}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MINOR BOARD
═══════════════════════════════════════════════════════════════════ */
function MinorBoard({cells,result,majorIdx,isActive,isMyTurn,canPlay,onMove,lastMove,isPickable,onPick}) {
  return (
    <div style={{
      position:"relative",display:"grid",gridTemplateColumns:"repeat(3,1fr)",
      gap:"clamp(2px,0.5vw,4px)",padding:"clamp(4px,0.8vw,7px)",borderRadius:6,
      background:isActive&&isMyTurn?"rgba(240,192,64,0.05)":C.minorBg,
      border:`2px solid ${isActive&&isMyTurn?C.accent:C.minorBorder}`,
      animation:isActive&&isMyTurn?"pulse 2s infinite":"none",
      transition:"border-color 0.3s,background 0.3s",
    }}>
      {cells.map((cell,i)=>(
        <MinorCell key={i} value={cell}
          canClick={canPlay&&!cell&&!result}
          isLast={lastMove?.majorIdx===majorIdx&&lastMove?.minorIdx===i}
          onClick={()=>canPlay&&!cell&&!result&&onMove(majorIdx,i)}
        />
      ))}
      {isPickable&&(
        <div onClick={e=>{e.stopPropagation();onPick&&onPick();}} style={{
          position:"absolute",inset:0,zIndex:10,borderRadius:5,cursor:"pointer",background:"transparent",
        }}/>
      )}
      {result&&(
        <div style={{
          position:"absolute",inset:0,borderRadius:5,backdropFilter:"blur(3px)",
          background:result==="draw"?"rgba(30,30,50,0.88)":result===X?"rgba(80,10,10,0.88)":"rgba(5,30,60,0.88)",
          display:"flex",alignItems:"center",justifyContent:"center",
          border:`2px solid ${result===X?C.x:result===O?C.o:C.muted}`,
        }}>
          <span style={{fontFamily:"'Orbitron',monospace",fontWeight:900,fontSize:"clamp(20px,5vw,38px)",
            color:result===X?C.x:result===O?C.o:C.muted,
            textShadow:`0 0 20px ${result===X?C.x:result===O?C.o:C.muted}`}}>
            {result==="draw"?"=":result}
          </span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAJOR BOARD
═══════════════════════════════════════════════════════════════════ */
function MajorBoard({game,mySymbol,onMove,onPickMajor,isMyTurn}) {
  const {minorBoards,majorResults,phase,activeMajor,lastMove}=game;
  const wLine=(()=>{for(const[a,b,c]of WIN_LINES){if(majorResults[a]&&majorResults[a]===majorResults[b]&&majorResults[a]===majorResults[c])return[a,b,c];}return null;})();
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"clamp(6px,1.5vw,12px)",padding:"clamp(8px,2vw,14px)",background:C.surface,border:`2px solid ${C.border}`,borderRadius:12,width:"100%",maxWidth:520,margin:"0 auto"}}>
      {minorBoards.map((cells,majIdx)=>{
        const result=majorResults[majIdx];
        const isPickable=isMyTurn&&phase==="pick_major"&&!result;
        const isActive=!result&&((phase==="pick_minor"&&(activeMajor===majIdx||activeMajor===null))||(phase==="pick_major"&&!result));
        const canPlay=isMyTurn&&!result&&phase==="pick_minor"&&(activeMajor===majIdx||activeMajor===null);
        const isWin=wLine?.includes(majIdx);
        return (
          <div key={majIdx} style={{cursor:isPickable?"pointer":"default",borderRadius:8,padding:2,outline:isPickable?`2px dashed ${C.accent}`:isWin?`2px solid ${C.accent}`:"2px solid transparent",background:isPickable?"rgba(240,192,64,0.04)":isWin?"rgba(240,192,64,0.06)":"transparent",transition:"outline 0.2s,background 0.2s"}}>
            <MinorBoard cells={cells} result={result} majorIdx={majIdx}
              isActive={isActive} isMyTurn={isMyTurn} canPlay={canPlay}
              onMove={onMove} lastMove={lastMove}
              isPickable={isPickable} onPick={()=>onPickMajor(majIdx)}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STATUS + TURN INDICATOR
═══════════════════════════════════════════════════════════════════ */
function StatusBar({game,mySymbol,mode,isMyTurn,waiting}) {
  const {winner,isDraw,phase,activeMajor}=game;
  let msg="",color=C.text;
  if(winner){msg=winner===mySymbol?"🎉 You win!":(mode==="vs-ai"?"🤖 CPU wins!":"😔 Opponent wins!");color=winner===mySymbol?C.success:C.err;}
  else if(isDraw){msg="🤝 It's a draw!";color=C.draw;}
  else if(waiting){msg="⏳ Waiting for opponent…";color=C.muted;}
  else if(!isMyTurn&&mode==="vs-ai"){msg="🤖 CPU thinking…";color=C.o;}
  else if(!isMyTurn){msg="⏳ Opponent's turn…";color=C.muted;}
  else if(phase==="pick_major"){msg="👆 Tap any board to start";color=C.accent;}
  else if(phase==="pick_minor"){msg=activeMajor===null?"👆 Pick any open board":`👆 Play in board ${activeMajor+1}`;color=C.accent;}
  return <div style={{textAlign:"center",padding:"6px 16px",minHeight:32,fontSize:"clamp(12px,3vw,15px)",fontWeight:600,color,transition:"color 0.3s"}}>{msg}</div>;
}
function TurnIndicator({game,mySymbol,mode}) {
  const {currentPlayer,winner,isDraw}=game;
  if(winner||isDraw) return null;
  const xL=mode==="local"?"Player 1":mySymbol===X?"You":(mode==="vs-ai"?"You":"Opp");
  const oL=mode==="local"?"Player 2":mySymbol===O?"You":(mode==="vs-ai"?"CPU":"Opp");
  return (
    <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:4}}>
      {[X,O].map(sym=>(
        <div key={sym} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,border:`2px solid ${currentPlayer===sym?(sym===X?C.x:C.o):C.border}`,background:currentPlayer===sym?(sym===X?C.xDim:C.oDim):"transparent",opacity:currentPlayer===sym?1:0.4,transition:"all 0.3s"}}>
          <span style={{fontFamily:"'Orbitron',monospace",fontWeight:900,fontSize:13,color:sym===X?C.x:C.o}}>{sym}</span>
          <span style={{fontSize:12,fontWeight:600,color:sym===X?C.x:C.o}}>{sym===X?xL:oL}</span>
          {currentPlayer===sym&&<span style={{width:5,height:5,borderRadius:"50%",background:sym===X?C.x:C.o,display:"inline-block"}}/>}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GAME OVER
═══════════════════════════════════════════════════════════════════ */
function GameOver({game,mySymbol,mode,onRematch,onHome,eloChange}) {
  const {winner,isDraw,majorResults}=game;
  if(!winner&&!isDraw) return null;
  const xC=majorResults.filter(r=>r===X).length, oC=majorResults.filter(r=>r===O).length;
  const isWin=winner===mySymbol;
  const borderCol=isDraw?C.draw:winner===X?C.x:C.o;
  return (
    <div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)",animation:"fadeIn 0.4s ease"}}>
      <div style={{background:C.card,border:`2px solid ${borderCol}`,borderRadius:20,padding:"clamp(24px,5vw,40px)",maxWidth:340,width:"90%",textAlign:"center",boxShadow:`0 0 80px ${borderCol}33`,animation:"slideUp 0.4s ease"}}>
        <div style={{fontSize:52,marginBottom:10}}>{isDraw?"🤝":isWin?"🏆":(mode==="vs-ai"&&winner===O)?"🤖":"💀"}</div>
        <h2 style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(18px,5vw,26px)",color:borderCol,marginBottom:8}}>
          {isDraw?"DRAW":isWin?"YOU WIN":(mode==="vs-ai"?"CPU WINS":"YOU LOSE")}
        </h2>
        <p style={{color:C.muted,fontSize:13,marginBottom:eloChange!=null?8:20}}>
          <span style={{color:C.x}}>✕ {xC}</span> – <span style={{color:C.o}}>○ {oC}</span> boards claimed
        </p>
        {eloChange!=null&&<p style={{fontSize:15,fontWeight:700,color:eloChange>=0?C.success:C.err,marginBottom:20}}>{eloChange>=0?`+${eloChange}`:eloChange} ELO</p>}
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button onClick={onRematch} style={{padding:"10px 22px",borderRadius:8,background:C.accent,color:C.bg,border:"none",fontWeight:700,fontSize:15,cursor:"pointer"}}>Rematch</button>
          <button onClick={onHome} style={{padding:"10px 22px",borderRadius:8,background:"transparent",color:C.muted,border:`1px solid ${C.border}`,fontWeight:600,fontSize:15,cursor:"pointer"}}>Home</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GAME SCREEN
═══════════════════════════════════════════════════════════════════ */
function GameScreen({mode,roomId,profile,updateProfile,onHome}) {
  const [game,setGame]=useState(initGame());
  const [myOnlineSym,setMyOnlineSym]=useState(null);
  const [roomData,setRoomData]=useState(null);
  const [waiting,setWaiting]=useState(mode==="online");
  const [aiThinking,setAiThinking]=useState(false);
  const [eloChange,setEloChange]=useState(null);
  const [oppProfile,setOppProfile]=useState(null);
  const pollRef=useRef(null);
  const eloApplied=useRef(false);

  const effSym=mode==="online"?myOnlineSym:X;
  const isMyTurn=(()=>{
    if(game.winner||game.isDraw) return false;
    if(mode==="local") return true;
    if(mode==="vs-ai") return game.currentPlayer===X;
    return myOnlineSym&&game.currentPlayer===myOnlineSym;
  })();

  const fetchOnline=useCallback(async()=>{
    if(mode!=="online") return;
    const data=await loadRoom(roomId);
    if(!data) return;
    const myId=profile?.id||"guest";
    const alreadyIn=data.players.find(p=>p.id===myId);
    if(!alreadyIn){
      if(data.players.length>=2) return;
      const sym=O;
      data.players.push({id:myId,symbol:sym,username:profile?.username||null,elo:profile?.elo||null,profileId:profile?.id||null});
      await saveRoom(roomId,data);
    }
    const me=data.players.find(p=>p.id===myId);
    if(me) setMyOnlineSym(me.symbol);
    if(!oppProfile){
      const opp=data.players.find(p=>p.id!==myId);
      if(opp?.profileId) supa.getProfile(opp.profileId,null).then(p=>{ if(p) setOppProfile(p); });
      else if(opp) setOppProfile({username:opp.username||"Guest",elo:opp.elo||null,id:null});
    }
    setRoomData(data);
    setGame(data.game);
    setWaiting(data.players.length<2);
  },[mode,roomId,profile]);

  useEffect(()=>{
    if(mode==="online"){fetchOnline();pollRef.current=setInterval(fetchOnline,1500);return()=>clearInterval(pollRef.current);}
  },[fetchOnline,mode]);

  // ELO update when online game ends
  useEffect(()=>{
    if(mode!=="online"||!profile||eloApplied.current) return;
    if(!game.winner&&!game.isDraw) return;
    if(!myOnlineSym) return;
    eloApplied.current=true;
    const myResult=game.isDraw?"draw":game.winner===myOnlineSym?"win":"loss";
    const delta=applyEloChanges(profile,oppProfile,myResult);
    setEloChange(delta);
    if(delta!==0||myResult!=="draw"){
      const s=profile.stats||{};
      s.played=(s.played||0)+1;
      if(myResult==="win") s.won=(s.won||0)+1;
      else if(myResult==="loss") s.lost=(s.lost||0)+1;
      else s.drawn=(s.drawn||0)+1;
      s.onlinePlayed=(s.onlinePlayed||0)+1;
      const mc=game.moveCount||0;
      if(mc>0){if(s.shortestGame==null||mc<s.shortestGame)s.shortestGame=mc;if(s.longestGame==null||mc>s.longestGame)s.longestGame=mc;}
      const newElo=(profile.elo||STARTING_ELO)+delta;
      s.eloHistory=[...(s.eloHistory||[STARTING_ELO]),newElo];
      updateProfile({elo:newElo,stats:s});
    }
  },[game.winner,game.isDraw,mode,profile,myOnlineSym,oppProfile,updateProfile]);

  useEffect(()=>{
    if(mode!=="vs-ai"||game.winner||game.isDraw||game.currentPlayer!==O||game.phase==="pick_major") return;
    setAiThinking(true);
    const t=setTimeout(()=>{
      const move=getAIMove(game);
      if(move) setGame(applyMove(game,move.majIdx,move.minIdx));
      setAiThinking(false);
    },500+Math.random()*400);
    return()=>clearTimeout(t);
  },[game,mode]);

  // Stats update for local / vs-ai
  const gameEndHandled=useRef(false);
  useEffect(()=>{
    if(mode==="online") return;
    if((!game.winner&&!game.isDraw)||gameEndHandled.current) return;
    gameEndHandled.current=true;
    if(!profile) return;
    const myResult=game.isDraw?"draw":game.winner===X?"win":"loss";
    const s=profile.stats||{};
    s.played=(s.played||0)+1;
    if(myResult==="win")s.won=(s.won||0)+1;
    else if(myResult==="loss")s.lost=(s.lost||0)+1;
    else s.drawn=(s.drawn||0)+1;
    const mc=game.moveCount||0;
    if(mc>0){if(s.shortestGame==null||mc<s.shortestGame)s.shortestGame=mc;if(s.longestGame==null||mc>s.longestGame)s.longestGame=mc;}
    updateProfile({stats:s});
  },[game.winner,game.isDraw,mode,profile,updateProfile]);

  async function handlePickMajor(majIdx){
    if(!isMyTurn||game.phase!=="pick_major") return;
    const ng={...game,activeMajor:majIdx,phase:"pick_minor"};
    setGame(ng);
    if(mode==="online"&&roomData){await saveRoom(roomId,{...roomData,game:ng});}
  }
  async function handleMove(majorIdx,minorIdx){
    if(!isMyTurn||aiThinking) return;
    const ng=applyMove(game,majorIdx,minorIdx);
    setGame(ng);
    if(mode==="online"&&roomData){const nd={...roomData,game:ng};await saveRoom(roomId,nd);setRoomData(nd);}
  }
  function handleRematch(){
    const ng=initGame(); setGame(ng); eloApplied.current=false; setEloChange(null); gameEndHandled.current=false;
    if(mode==="online"&&roomData) saveRoom(roomId,{...roomData,game:ng});
  }

  const modeLabel=mode==="vs-ai"?"vs Computer":mode==="local"?"Local 2P":`Online · ${roomId}`;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",minHeight:"100dvh",padding:"clamp(10px,2.5vw,20px)",animation:"fadeIn 0.4s ease"}}>
      <div style={{width:"100%",maxWidth:520,display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <button onClick={onHome} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:13}}>← Home</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(13px,3.2vw,18px)",color:C.accent,letterSpacing:2,animation:"glow 3s infinite"}}>TAC TIC TOE</div>
          <div style={{fontSize:10,color:C.muted,marginTop:1}}>{modeLabel}</div>
        </div>
        <div style={{width:80}}/>
      </div>
      <TurnIndicator game={game} mySymbol={effSym} mode={mode}/>
      <StatusBar game={game} mySymbol={effSym} mode={mode} isMyTurn={isMyTurn} waiting={waiting}/>
      {waiting&&mode==="online"?(
        <div style={{textAlign:"center",marginTop:40}}>
          <div style={{fontSize:36,marginBottom:12,display:"inline-block",animation:"spin 2s linear infinite"}}>⧖</div>
          <p style={{color:C.muted,fontSize:14,marginBottom:16}}>Waiting for opponent to join…</p>
          <div style={{padding:"14px 28px",background:C.card,borderRadius:10,border:`1px solid ${C.border}`}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,letterSpacing:1}}>ROOM CODE</p>
            <p style={{fontFamily:"'Orbitron',monospace",fontSize:28,color:C.accent,letterSpacing:6}}>{roomId}</p>
          </div>
        </div>
      ):(
        <MajorBoard game={game} mySymbol={effSym} onMove={handleMove} onPickMajor={handlePickMajor} isMyTurn={isMyTurn&&!aiThinking}/>
      )}
      {!game.winner&&!game.isDraw&&!waiting&&(
        <div style={{marginTop:10,display:"flex",gap:12,fontSize:10,color:C.muted}}>
          <span>🟡 Active board</span><span>·</span><span>Your pick → opponent's next board</span>
        </div>
      )}
      <GameOver game={game} mySymbol={effSym||X} mode={mode} onRematch={handleRematch} onHome={onHome} eloChange={mode==="online"?eloChange:null}/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   QUICK PLAY
═══════════════════════════════════════════════════════════════════ */
const QP_PREFIX="ttt:qp:";
const QP_ELO_WINDOW=100, QP_RELAX_MS=5000, QP_TIMEOUT_MS=30000;

function QuickPlay({profile,onJoin}) {
  const [phase,setPhase]=useState("idle");
  const [elapsed,setElapsed]=useState(0);
  const [matchInfo,setMatchInfo]=useState(null);
  const timerRef=useRef(null), pollRef=useRef(null), startRef=useRef(null);
  useEffect(()=>()=>{clearInterval(timerRef.current);clearInterval(pollRef.current);},[]);

  async function startSearch(){
    setPhase("searching");setElapsed(0);setMatchInfo(null);
    startRef.current=Date.now();
    await kvSet(`${QP_PREFIX}${profile.id}`,{id:profile.id,username:profile.username,elo:profile.elo||STARTING_ELO,status:"waiting",ts:Date.now()});
    timerRef.current=setInterval(()=>setElapsed(Math.floor((Date.now()-startRef.current)/1000)),500);
    pollRef.current=setInterval(async()=>{
      const timeIn=Date.now()-startRef.current;
      if(timeIn>QP_TIMEOUT_MS){clearInterval(timerRef.current);clearInterval(pollRef.current);await kvDel(`${QP_PREFIX}${profile.id}`);setPhase("timeout");return;}
      const myEntry=await kvGet(`${QP_PREFIX}${profile.id}`);
      if(!myEntry) return;
      if(myEntry.status==="matched"&&myEntry.roomId){clearInterval(timerRef.current);clearInterval(pollRef.current);setPhase("matched");setTimeout(()=>onJoin(myEntry.roomId),800);return;}
      const rows=await kvList(QP_PREFIX);
      const others=rows.filter(r=>r.key!==`${QP_PREFIX}${profile.id}`).map(r=>{try{return JSON.parse(r.value);}catch{return null;}}).filter(e=>e&&e.status==="waiting"&&Date.now()-e.ts<45000);
      if(!others.length) return;
      const myElo=profile.elo||STARTING_ELO;
      const useWindow=timeIn<QP_RELAX_MS;
      const candidates=useWindow?others.filter(e=>Math.abs(e.elo-myElo)<=QP_ELO_WINDOW):others;
      if(!candidates.length) return;
      const opp=candidates.reduce((b,e)=>Math.abs(e.elo-myElo)<Math.abs(b.elo-myElo)?e:b,candidates[0]);
      const rid=genId(5);
      await saveRoom(rid,{id:rid,players:[{id:profile.id,symbol:X,username:profile.username,elo:profile.elo||STARTING_ELO,profileId:profile.id}],game:initGame(),createdAt:Date.now(),quickPlay:true});
      await kvSet(`${QP_PREFIX}${profile.id}`,{...myEntry,status:"matched",roomId:rid});
      const oppEntry=await kvGet(`${QP_PREFIX}${opp.id}`);
      if(oppEntry&&oppEntry.status==="waiting"){
        await kvSet(`${QP_PREFIX}${opp.id}`,{...oppEntry,status:"matched",roomId:rid});
        clearInterval(timerRef.current);clearInterval(pollRef.current);
        setMatchInfo({oppName:opp.username,oppElo:opp.elo});setPhase("matched");
        setTimeout(()=>onJoin(rid),800);
      }
    },1200);
  }
  async function cancelSearch(){clearInterval(timerRef.current);clearInterval(pollRef.current);await kvDel(`${QP_PREFIX}${profile.id}`);setPhase("idle");setElapsed(0);}
  const dots=".".repeat((elapsed%3)+1).padEnd(3,"\u00a0");
  return (
    <div style={{textAlign:"center",padding:"24px 0"}}>
      {phase==="idle"&&<>
        <div style={{fontSize:48,marginBottom:12}}>⚡</div>
        <p style={{color:C.text,fontSize:16,fontWeight:600,marginBottom:6}}>Quick Play</p>
        <p style={{color:"#b8b8d0",fontSize:13,marginBottom:20,lineHeight:1.5}}>Matched by ELO. Prefers ±{QP_ELO_WINDOW} pts, expands after {QP_RELAX_MS/1000}s.</p>
        <div style={{padding:"10px 16px",background:C.card,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:20,display:"inline-block"}}>
          <span style={{fontSize:13,color:C.muted}}>Your ELO: </span>
          <span style={{fontFamily:"'Orbitron',monospace",color:C.accent,fontWeight:700}}>{profile.elo||STARTING_ELO}</span>
        </div><br/>
        <button onClick={startSearch} style={{padding:"12px 32px",background:`linear-gradient(135deg,${C.success},#2a8a5a)`,color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:16,cursor:"pointer"}}>Find Match</button>
      </>}
      {phase==="searching"&&<>
        <div style={{fontSize:40,marginBottom:12,display:"inline-block",animation:"spin 1.5s linear infinite"}}>⧖</div>
        <p style={{color:C.accent,fontSize:16,fontWeight:700,marginBottom:4}}>Searching{dots}</p>
        <p style={{color:C.muted,fontSize:13,marginBottom:4}}>{elapsed<QP_RELAX_MS/1000?`Looking for ±${QP_ELO_WINDOW} ELO…`:"Expanding search…"}</p>
        <p style={{color:C.muted,fontSize:11,marginBottom:20}}>{elapsed}s / {QP_TIMEOUT_MS/1000}s</p>
        <div style={{width:"100%",maxWidth:240,margin:"0 auto 20px",height:4,background:C.border,borderRadius:2}}>
          <div style={{height:4,borderRadius:2,background:elapsed<QP_RELAX_MS/1000?C.success:C.accent,width:`${Math.min(100,(elapsed/(QP_TIMEOUT_MS/1000))*100)}%`,transition:"width 1s linear"}}/>
        </div>
        <button onClick={cancelSearch} style={{padding:"9px 22px",background:"transparent",color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,fontWeight:600,fontSize:14,cursor:"pointer"}}>Cancel</button>
      </>}
      {phase==="matched"&&<>
        <div style={{fontSize:48,marginBottom:12}}>🎮</div>
        <p style={{color:C.success,fontSize:18,fontWeight:700,marginBottom:6}}>Match Found!</p>
        {matchInfo&&<p style={{color:C.muted,fontSize:14}}>vs <span style={{color:C.text,fontWeight:600}}>{matchInfo.oppName}</span> (ELO {matchInfo.oppElo})</p>}
        <p style={{color:C.muted,fontSize:13,marginTop:8}}>Starting game…</p>
      </>}
      {phase==="timeout"&&<>
        <div style={{fontSize:48,marginBottom:12}}>😔</div>
        <p style={{color:C.err,fontSize:16,fontWeight:700,marginBottom:8}}>No match found</p>
        <p style={{color:C.muted,fontSize:13,marginBottom:20}}>No players available. Try a room code instead.</p>
        <button onClick={()=>{setPhase("idle");setElapsed(0);}} style={{padding:"10px 22px",background:C.accent,color:C.bg,border:"none",borderRadius:8,fontWeight:700,fontSize:14,cursor:"pointer"}}>Try Again</button>
      </>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ONLINE LOBBY
═══════════════════════════════════════════════════════════════════ */
function OnlineLobby({profile,onJoin,onBack}) {
  const [tab,setTab]=useState(profile?"quick":"room");
  const [code,setCode]=useState("");
  const [rooms,setRooms]=useState([]);
  useEffect(()=>{
    async function fetch(){
      const rows=await kvList("ttt:r:");
      const loaded=[];
      for(const row of rows.slice(0,12)){
        try{
          const d=typeof row.value==="string"?JSON.parse(row.value):row.value;
          if(!d.game?.winner&&!d.game?.isDraw&&d.players?.length<2&&!d.quickPlay)
            loaded.push({id:row.key.replace("ttt:r:","")});
        }catch{}
      }
      setRooms(loaded);
    }
    fetch();const t=setInterval(fetch,3000);return()=>clearInterval(t);
  },[]);
  async function create(){
    const id=genId(5);
    await saveRoom(id,{id,players:[{id:profile?.id||("guest_"+genId(6)),symbol:X,username:profile?.username||null,elo:profile?.elo||null,profileId:profile?.id||null}],game:initGame(),createdAt:Date.now()});
    onJoin(id);
  }
  const tabStyle=(active)=>({flex:1,padding:"10px 0",background:active?C.accent:"transparent",color:active?C.bg:C.muted,border:"none",fontWeight:700,fontSize:14,cursor:"pointer"});
  return (
    <div style={{animation:"fadeIn 0.3s ease",maxWidth:400,margin:"0 auto",padding:"clamp(16px,4vw,32px)"}}>
      <button onClick={onBack} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:14,marginBottom:20}}>← Back</button>
      <h2 style={{fontFamily:"'Orbitron',monospace",color:C.accent,fontSize:20,marginBottom:16}}>Online Play</h2>
      {profile&&<div style={{padding:"8px 14px",background:C.card,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:16,fontSize:13,color:C.muted}}>Playing as <span style={{color:C.accent,fontWeight:700}}>{profile.username}</span> · ELO <span style={{color:C.text,fontWeight:700}}>{profile.elo||STARTING_ELO}</span></div>}
      <div style={{display:"flex",borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,marginBottom:20}}>
        {profile&&<button style={tabStyle(tab==="quick")} onClick={()=>setTab("quick")}>⚡ Quick Play</button>}
        <button style={tabStyle(tab==="room")} onClick={()=>setTab("room")}>🔑 Room Code</button>
      </div>
      {tab==="quick"&&profile&&<QuickPlay profile={profile} onJoin={onJoin}/>}
      {tab==="room"&&<>
        <button onClick={create} style={{width:"100%",padding:"14px 0",background:`linear-gradient(135deg,${C.accent},${C.accentDim})`,color:C.bg,border:"none",borderRadius:10,fontWeight:700,fontSize:16,cursor:"pointer",marginBottom:16}}>+ Create Room</button>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          <input value={code} onChange={e=>setCode(e.target.value.toUpperCase().slice(0,6))} placeholder="Room Code" style={{flex:1,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontFamily:"'Orbitron',monospace",fontSize:14,outline:"none",letterSpacing:2}}/>
          <button onClick={()=>code.length>=4&&onJoin(code)} style={{padding:"12px 16px",background:C.o,color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:15}}>Join</button>
        </div>
        {rooms.length>0&&<><p style={{fontSize:11,color:C.muted,marginBottom:8,letterSpacing:1}}>OPEN ROOMS</p>
          {rooms.map(r=>(
            <div key={r.id} onClick={()=>onJoin(r.id)} style={{padding:"12px 16px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent} onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
              <span style={{fontFamily:"'Orbitron',monospace",color:C.accent,letterSpacing:2}}>{r.id}</span>
              <span style={{fontSize:12,color:C.muted}}>1/2 · Join</span>
            </div>
          ))}</>}
        {!profile&&<p style={{fontSize:12,color:C.muted,textAlign:"center",marginTop:16,lineHeight:1.5}}>💡 Sign in to use Quick Play and earn ELO.</p>}
      </>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STATS SCREEN
═══════════════════════════════════════════════════════════════════ */
function StatsScreen({profile,onBack}) {
  const s=profile.stats||{};
  const played=s.played||0,won=s.won||0,lost=s.lost||0,drawn=s.drawn||0;
  const winPct=played>0?Math.round((won/played)*100):0;
  const elo=profile.elo||STARTING_ELO;
  const eloTier=elo<1000?"Novice":elo<1200?"Beginner":elo<1400?"Intermediate":elo<1600?"Advanced":elo<1800?"Expert":elo<2000?"Master":"Grandmaster";
  const eloColor=elo<1200?C.muted:elo<1400?C.text:elo<1600?C.o:elo<1800?C.success:elo<2000?C.accent:"#ff9f40";
  const cards=[{l:"Games Played",v:played,c:C.text},{l:"Won",v:won,c:C.success},{l:"Lost",v:lost,c:C.err},{l:"Drawn",v:drawn,c:C.draw},{l:"Win Rate",v:`${winPct}%`,c:C.accent},{l:"Shortest Game",v:s.shortestGame!=null?`${s.shortestGame} moves`:"—",c:C.o},{l:"Longest Game",v:s.longestGame!=null?`${s.longestGame} moves`:"—",c:C.o},{l:"Online Played",v:s.onlinePlayed||0,c:C.muted}];
  return (
    <div style={{animation:"fadeIn 0.3s ease",maxWidth:440,margin:"0 auto",padding:"clamp(16px,4vw,32px)"}}>
      <button onClick={onBack} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:14,marginBottom:20}}>← Back</button>
      <h2 style={{fontFamily:"'Orbitron',monospace",color:C.accent,fontSize:20,marginBottom:6}}>Statistics</h2>
      <p style={{color:C.muted,fontSize:13,marginBottom:20}}>{profile.username}</p>
      <div style={{padding:"20px 24px",background:C.card,border:`2px solid ${eloColor}44`,borderRadius:14,marginBottom:20,textAlign:"center"}}>
        <p style={{fontSize:11,color:C.muted,letterSpacing:2,marginBottom:4}}>ELO RATING</p>
        <p style={{fontFamily:"'Orbitron',monospace",fontSize:42,fontWeight:900,color:eloColor,lineHeight:1}}>{elo}</p>
        <p style={{fontSize:13,color:"#b8b8d0",marginTop:6}}>{eloTier}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {cards.map(({l,v,c})=>(
          <div key={l} style={{padding:"14px 16px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10}}>
            <p style={{fontSize:10,color:C.muted,letterSpacing:0.5,marginBottom:4}}>{l.toUpperCase()}</p>
            <p style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(16px,4vw,22px)",fontWeight:700,color:c}}>{v}</p>
          </div>
        ))}
      </div>
      {(s.eloHistory?.length||0)>1&&(
        <div style={{marginTop:20,padding:"16px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10}}>
          <p style={{fontSize:11,color:C.muted,letterSpacing:1,marginBottom:12}}>ELO HISTORY</p>
          <div style={{display:"flex",alignItems:"flex-end",gap:3,height:60}}>
            {s.eloHistory.slice(-20).map((v,i)=>{
              const mn=Math.min(...s.eloHistory),mx=Math.max(...s.eloHistory);
              const h=mx===mn?30:Math.max(4,((v-mn)/(mx-mn))*56);
              return <div key={i} style={{flex:1,height:h,borderRadius:2,background:i===Math.min(s.eloHistory.length,20)-1?C.accent:C.border,transition:"height 0.3s"}}/>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════════════════ */
function AuthScreen({onAuth,onBack,onSuccess}) {
  const [tab,setTab]=useState("login");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [msg,setMsg]=useState("");
  const [loading,setLoading]=useState(false);
  const {signUp,signIn}=onAuth;

  async function handleSubmit(){
    if(!username.trim()||!password.trim()){setMsg("Fill in all fields.");return;}
    if(username.length<3){setMsg("Username must be 3+ characters.");return;}
    if(password.length<6){setMsg("Password must be 6+ characters.");return;}
    if(!/^[a-zA-Z0-9_]+$/.test(username)){setMsg("Username: letters, numbers, underscores only.");return;}
    setLoading(true);setMsg("");
    const result = tab==="register"
      ? await signUp(username.trim(), password)
      : await signIn(username.trim(), password);
    if(result?.error){setMsg(result.error);setLoading(false);return;}
    setLoading(false);
    onSuccess();
  }

  const inputStyle={width:"100%",padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:15,outline:"none",marginBottom:12};
  return (
    <div style={{animation:"fadeIn 0.3s ease",maxWidth:360,margin:"0 auto",padding:"clamp(16px,4vw,32px)"}}>
      <button onClick={onBack} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:14,marginBottom:20}}>← Back</button>
      <h2 style={{fontFamily:"'Orbitron',monospace",color:C.accent,fontSize:20,marginBottom:24}}>Account</h2>
      <div style={{display:"flex",borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,marginBottom:24}}>
        {["login","register"].map(t=>(
          <button key={t} onClick={()=>{setTab(t);setMsg("");}} style={{flex:1,padding:"10px 0",background:tab===t?C.accent:"transparent",color:tab===t?C.bg:C.muted,border:"none",fontWeight:700,fontSize:14,cursor:"pointer"}}>{t==="login"?"Sign In":"Register"}</button>
        ))}
      </div>
      <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username" style={inputStyle} autoCapitalize="none" autoCorrect="off" autoComplete="username"/>
      <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" type="password" style={inputStyle} autoComplete={tab==="register"?"new-password":"current-password"}/>
      {msg&&<p style={{color:C.err,fontSize:13,marginBottom:12}}>{msg}</p>}
      <button onClick={handleSubmit} disabled={loading} style={{width:"100%",padding:"13px 0",background:`linear-gradient(135deg,${C.accent},${C.accentDim})`,color:C.bg,border:"none",borderRadius:10,fontWeight:700,fontSize:16,cursor:"pointer",opacity:loading?0.7:1}}>
        {loading?"…":tab==="login"?"Sign In":"Create Account"}
      </button>
      <p style={{color:"#b8b8d0",fontSize:13,marginTop:16,textAlign:"center",lineHeight:1.5}}>
        {tab==="login"?"No account? Switch to Register above.":"Passwords are handled securely by Supabase — never stored in plain text."}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   INSTRUCTIONS
═══════════════════════════════════════════════════════════════════ */
function Instructions({onBack}) {
  const steps=[
    ["🎯","Objective","Win 3 major squares in a row — each major square contains a full minor Tic-Tac-Toe game."],
    ["1️⃣","First Move","✕ taps any of the 9 major boards to start in, then places their piece in a minor square."],
    ["🔀","Core Rule","Your minor square choice determines which major board your opponent must play in next."],
    ["✅","Claiming","Win 3-in-a-row in a minor board to claim that major square. A draw blocks it."],
    ["🆓","Free Choice","If sent to a completed board, your opponent picks any open board instead."],
    ["🏆","Winning","First to 3 claimed major squares in a line wins! Tiebreaker: most claimed squares."],
  ];
  return (
    <div style={{animation:"fadeIn 0.3s ease",maxWidth:460,margin:"0 auto",padding:"clamp(16px,4vw,32px)"}}>
      <button onClick={onBack} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:14,marginBottom:20}}>← Back</button>
      <h2 style={{fontFamily:"'Orbitron',monospace",color:C.accent,fontSize:20,marginBottom:20}}>How to Play</h2>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {steps.map(([icon,title,text],i)=>(
          <div key={i} style={{padding:"14px 16px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,animation:`fadeIn 0.4s ease ${i*0.06}s both`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <span style={{fontSize:20}}>{icon}</span>
              <span style={{fontFamily:"'Orbitron',monospace",fontSize:12,color:C.accent}}>{title}</span>
            </div>
            <p style={{fontSize:"clamp(13px,2.8vw,15px)",color:"#d8d8ee",lineHeight:1.65}}>{text}</p>
          </div>
        ))}
      </div>
      <div style={{marginTop:16,padding:"14px 16px",background:"rgba(240,192,64,0.05)",border:`1px solid ${C.accentDim}`,borderRadius:10}}>
        <p style={{fontSize:13,color:C.accent,fontWeight:600,marginBottom:4}}>💡 ELO Rating</p>
        <p style={{fontSize:13,color:"#b8b8d0",lineHeight:1.6}}>Online games between two registered players use chess-style ELO (K=32). Games vs guests use a fixed ±{GUEST_ELO_CHANGE}. Starting ELO: {STARTING_ELO}.</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MENU BUTTON + HOME
═══════════════════════════════════════════════════════════════════ */
function MenuButton({icon,label,sublabel,color,onClick}) {
  const [h,setH]=useState(false);
  return (
    <button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} onTouchStart={()=>setH(true)} onTouchEnd={()=>setH(false)} style={{width:"100%",padding:"clamp(14px,3vw,20px) clamp(14px,3vw,22px)",background:h?`${color}12`:C.card,border:`2px solid ${h?color:C.border}`,borderRadius:14,cursor:"pointer",display:"flex",alignItems:"center",gap:14,textAlign:"left",transition:"all 0.2s",transform:h?"translateY(-1px)":"translateY(0)",boxShadow:h?`0 6px 20px ${color}22`:"none",position:"relative"}}>
      <span style={{fontSize:"clamp(26px,6vw,34px)"}}>{icon}</span>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(12px,3.2vw,15px)",color,fontWeight:700,marginBottom:2}}>{label}</div>
        <div style={{fontSize:"clamp(10px,2.3vw,12px)",color:C.muted}}>{sublabel}</div>
      </div>
      <span style={{color:h?color:C.muted,fontSize:20,transition:"transform 0.2s",transform:h?"translateX(4px)":"none"}}>›</span>
    </button>
  );
}

function HomeScreen({profile,onSelect,onSignOut}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100dvh",padding:"clamp(20px,5vw,48px)",animation:"fadeIn 0.5s ease"}}>
      <div style={{textAlign:"center",marginBottom:"clamp(24px,5vw,44px)"}}>
        <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(28px,8vw,52px)",fontWeight:900,color:C.accent,letterSpacing:"clamp(2px,1vw,6px)",lineHeight:1,animation:"glow 3s infinite"}}>TAC TIC TOE</div>
        <div style={{fontSize:"clamp(10px,2vw,13px)",color:"#b8b8d0",marginTop:8,letterSpacing:"clamp(2px,1vw,5px)",textTransform:"uppercase"}}>Ultimate Tic-Tac-Toe</div>
        <div style={{display:"flex",gap:5,justifyContent:"center",marginTop:16}}>
          {[C.x,C.o,C.x,C.o,C.accent,C.o,C.x,C.o,C.x].map((col,i)=>(
            <div key={i} style={{width:"clamp(5px,1.3vw,9px)",height:"clamp(5px,1.3vw,9px)",borderRadius:2,background:col,opacity:0.75,animation:`fadeIn 0.4s ease ${i*0.05}s both`}}/>
          ))}
        </div>
      </div>
      <div style={{width:"100%",maxWidth:390,marginBottom:14}}>
        {profile?(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:10}}>
            <div>
              <span style={{fontSize:13,color:C.accent,fontWeight:700}}>{profile.username}</span>
              <span style={{fontSize:12,color:C.muted,marginLeft:10}}>ELO <span style={{color:C.text,fontWeight:600}}>{profile.elo||STARTING_ELO}</span></span>
            </div>
            <button onClick={onSignOut} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:12}}>Sign out</button>
          </div>
        ):null}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:390}}>
        <MenuButton icon="🤖" label="vs Computer" sublabel="Play against AI" color={C.o} onClick={()=>onSelect("vs-ai")}/>
        <MenuButton icon="👥" label="Local 2 Player" sublabel="Pass & play on one device" color={C.x} onClick={()=>onSelect("local")}/>
        <MenuButton icon="🌐" label="Online Multiplayer" sublabel="Play with a friend online" color={C.success} onClick={()=>onSelect("online-lobby")}/>
        {profile&&<MenuButton icon="📊" label="My Statistics" sublabel={`${profile.stats?.played||0} games played`} color={C.accent} onClick={()=>onSelect("stats")}/>}
        {!profile&&<MenuButton icon="👤" label="Sign In / Register" sublabel="Track stats & earn ELO" color={C.accent} onClick={()=>onSelect("auth")}/>}
        <MenuButton icon="📖" label="How to Play" sublabel="Rules & strategy tips" color={C.muted} onClick={()=>onSelect("instructions")}/>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen,setScreen]=useState("home");
  const [roomId,setRoomId]=useState(null);
  const {session,profile,authLoading,signUp,signIn,signOut,updateProfile}=useAuth();

  const authHandlers={signUp,signIn};

  if(authLoading) return (
    <>
      <style>{GS}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100dvh"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Orbitron',monospace",fontSize:22,color:C.accent,animation:"glow 2s infinite",marginBottom:16}}>TAC TIC TOE</div>
          <div style={{fontSize:32,animation:"spin 1.5s linear infinite",display:"inline-block"}}>⧖</div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{GS}</style>
      <div style={{maxWidth:600,margin:"0 auto"}}>
        {!isConfigured() && <SetupScreen/>}
        {isConfigured() && <>
          {screen==="home"&&<HomeScreen profile={profile} onSelect={s=>setScreen(s)} onSignOut={signOut}/>}
          {screen==="vs-ai"&&<GameScreen mode="vs-ai" profile={profile} updateProfile={updateProfile} onHome={()=>setScreen("home")}/>}
          {screen==="local"&&<GameScreen mode="local" profile={profile} updateProfile={updateProfile} onHome={()=>setScreen("home")}/>}
          {screen==="online-lobby"&&<OnlineLobby profile={profile} onJoin={id=>{setRoomId(id);setScreen("online");}} onBack={()=>setScreen("home")}/>}
          {screen==="online"&&roomId&&<GameScreen mode="online" roomId={roomId} profile={profile} updateProfile={updateProfile} onHome={()=>setScreen("home")}/>}
          {screen==="stats"&&profile&&<StatsScreen profile={profile} onBack={()=>setScreen("home")}/>}
          {screen==="auth"&&<AuthScreen onAuth={authHandlers} onBack={()=>setScreen("home")} onSuccess={()=>setScreen("home")}/>}
          {screen==="instructions"&&<Instructions onBack={()=>setScreen("home")}/>}
        </>}
      </div>
    </>
  );
}