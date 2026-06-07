import React, { useState, useEffect } from "react";
import {
  View, Text, Image, ScrollView, TouchableOpacity, TextInput,
  Modal, FlatList, SafeAreaView, Alert, Linking, ActivityIndicator,
} from "react-native";
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
const FB_API_KEY = "AIzaSyCX6kZsPUvf2EEARZKEeTdZJS-fR3geHKE";
const FB_PROJECT = "lescarhandball-529c0";
const DB_URL = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts`;
const COACH_EMAIL = "steffdelaseuva@gmail.com";

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${FB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d;
}
async function signUp(email, password) {
  const r = await fetch(`${AUTH_URL}:signUp?key=${FB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d;
}

// ─── TOKEN REFRESH ───────────────────────────────────────────────────────────
async function refreshToken(refreshTokenStr) {
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshTokenStr }),
    });
    const d = await r.json();
    if (d.id_token) return d.id_token;
  } catch(e) {}
  return null;
}

// ─── FIRESTORE ────────────────────────────────────────────────────────────────
// Token global mis à jour après login
let _fbToken = null;
function setFbToken(token) { _fbToken = token; }
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_fbToken) h['Authorization'] = `Bearer ${_fbToken}`;
  return h;
}

async function fbGet(collection) {
  try {
    const r = await fetch(`${DB_URL}/${collection}?key=${FB_API_KEY}`, { headers: authHeaders() });
    const d = await r.json();
    if (!d.documents) return [];
    return d.documents.map(doc => {
      const id = doc.name.split('/').pop();
      const fields = doc.fields || {};
      const obj = { _id: id };
      Object.keys(fields).forEach(k => {
        const v = fields[k];
        if (v.stringValue !== undefined) obj[k] = v.stringValue;
        else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
        else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
        else if (v.arrayValue !== undefined) obj[k] = (v.arrayValue.values || []).map(x => x.stringValue || x.integerValue || x.booleanValue);
        else if (v.mapValue !== undefined) {
          const map = {};
          Object.keys(v.mapValue.fields || {}).forEach(mk => {
            const mv = v.mapValue.fields[mk];
            map[mk] = mv.stringValue || mv.booleanValue || mv.integerValue || '';
          });
          obj[k] = map;
        }
      });
      return obj;
    });
  } catch(e) { return []; }
}
function toFields(obj) {
  const fields = {};
  Object.keys(obj).forEach(k => {
    if (k === '_id') return;
    const v = obj[k];
    if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map(x => ({ stringValue: String(x) })) } };
    else if (typeof v === 'object' && v !== null) {
      const mapFields = {};
      Object.keys(v).forEach(mk => { mapFields[mk] = { stringValue: String(v[mk] || '') }; });
      fields[k] = { mapValue: { fields: mapFields } };
    }
    else fields[k] = { stringValue: String(v || '') };
  });
  return fields;
}
async function fbSet(collection, id, data) {
  try {
    await fetch(`${DB_URL}/${collection}/${id}?key=${FB_API_KEY}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ fields: toFields(data) }),
    });
  } catch(e) {}
}
async function fbDel(collection, id) {
  try { await fetch(`${DB_URL}/${collection}/${id}?key=${FB_API_KEY}`, { method: 'DELETE', headers: authHeaders() }); } catch(e) {}
}

// ─── THÈME ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#0D0D1A", card:"#1A1A2E", card2:"#16213E",
  primary:"#6C3FC5", primaryLight:"#8B5CF6",
  gold:"#FFD700", white:"#FFFFFF", gray:"#94a3b8",
  border:"#2D2D4E", input:"#12122A",
  green:"#10B981", red:"#EF4444", blue:"#3B82F6",
  orange:"#F97316",
};
const SHADOW = { shadowColor:"#6C3FC5", shadowOffset:{width:0,height:4}, shadowOpacity:0.3, shadowRadius:8, elevation:8 };
const POSTES = ["Gardien","Arrière G","Arrière D","Demi-centre","Ailier G","Ailier D","Pivot"];
const TYPE_CONFIG = {
  match:        { color:"#EF4444", light:"#2A1A1A", icon:"⚔️",  label:"Match" },
  entrainement: { color:"#3B82F6", light:"#1A1A2A", icon:"🏃",  label:"Entraînement" },
  rdv:          { color:"#FFD700", light:"#2A2A1A", icon:"📅",  label:"Rendez-vous" },
  tournoi:      { color:"#8B5CF6", light:"#1E1A2A", icon:"🏆",  label:"Tournoi" },
};
const EQUIPES = [
  { id:"groupe",  label:"Groupe -15F", color:"#10B981", subtitle:"24 joueuses", logo:require('./assets/LogoLHB.png') },
  { id:"equipe1", label:"Équipe 1",    color:"#3B82F6", subtitle:"-15F",        logo:require('./assets/Horacek.jpg') },
  { id:"equipe2", label:"Équipe 2",    color:"#EF4444", subtitle:"-15F",        logo:require('./assets/Sako.jpg') },
];
const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_SHORT = ["L","M","M","J","V","S","D"];
const LIEN_E1 = 'https://www.ffhandball.fr/competitions/saison-2025-2026-21/departemental/championnat-13-ans-feminins-28826/poule-180763/journee-7/';
const LIEN_E2 = 'https://www.ffhandball.fr/competitions/saison-2025-2026-21/departemental/championnat-13-ans-feminins-28826/poule-180772/';
const ROLES_LIST_DEFAULT = ["🚗 Co-voiturage (je conduis)","🚗 Co-voiturage (je dépose ma fille)","📋 Table de marque","🍰 Goûter","👕 Maillots","🥤 Buvette"];

// ─── PERMISSIONS ─────────────────────────────────────────────────────────────
// Rôles : "coach" (principal), "adjoint", "parent"
// Permissions coachs adjoints :
//   canEditCalendar, canManageSondages, canManagePresences, canManagePlayers, canSendMessages
function getRole(user) {
  if (!user) return "parent";
  if (user.isCoach) return "coach";
  if (user.isAdjoint) return "adjoint";
  return "parent";
}
function can(user, action) {
  const role = getRole(user);
  if (role === "coach") return true; // coach principal : tout
  if (role === "adjoint") {
    const perms = user.adjointPerms || {};
    const map = {
      editCalendar:    perms.canEditCalendar,
      manageSondages:  perms.canManageSondages,
      managePresences: perms.canManagePresences,
      managePlayers:   perms.canManagePlayers,
      sendMessages:    perms.canSendMessages,
    };
    return !!map[action];
  }
  if (action === "repondreSondage") return true;
  if (action === "inscriptionRole") return true; // toujours autorisé pour les parents
  const pp = user.parentPerms || {};
  const parentMap = {
    sendMessages:     !!pp.canSendMessages,
    createSondages:   !!pp.canCreateSondages,
    manageSondages:   !!pp.canCreateSondages,
    managePresences:  !!pp.canManagePresences,
    voirAnnuaire:     !!pp.canVoirAnnuaire,
  };
  return !!parentMap[action];
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function fmt(d) { if(!d) return ""; const [y,m,day]=d.split("-"); return `${day}/${m}/${y}`; }
function getDays(y,m) { return new Date(y,m+1,0).getDate(); }
function getFirst(y,m) { let d=new Date(y,m,1).getDay(); return d===0?6:d-1; }
const ACOLORS = ["#6C3FC5","#3B82F6","#10B981","#FFD700","#EF4444","#EC4899","#F97316","#8B5CF6"];
function aColor(s) { let h=0; for(let c of s) h+=c.charCodeAt(0); return ACOLORS[h%ACOLORS.length]; }
function todayFmt() { const t=new Date(); return `${String(t.getDate()).padStart(2,"0")}/${String(t.getMonth()+1).padStart(2,"0")}/${t.getFullYear()}`; }
function timeStr() { const t=new Date(); return `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`; }
function todayStr() { const t=new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; }

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function Avatar({ initials, size=42 }) {
  return (
    <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:aColor(initials),alignItems:"center",justifyContent:"center",borderWidth:1.5,borderColor:C.gold}}>
      <Text style={{color:C.white,fontWeight:"800",fontSize:size*0.36}}>{initials}</Text>
    </View>
  );
}
function GoldText({ children, style }) { return <Text style={[{color:C.gold,fontWeight:"800"},style]}>{children}</Text>; }
function Card({ children, style }) { return <View style={[{backgroundColor:C.card,borderRadius:16,padding:14,borderWidth:1,borderColor:C.border,marginBottom:10,...SHADOW},style]}>{children}</View>; }
function Btn({ children, onPress, variant="primary", small, style }) {
  const bg={primary:C.primary,gold:C.gold,danger:"#3A1A1A",secondary:C.card2,ghost:"transparent",green:"#0A2A1A",orange:"#2A1A0A"};
  const tc={primary:C.white,gold:"#0D0D1A",danger:C.red,secondary:C.gray,ghost:C.gold,green:C.green,orange:C.orange};
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}
      style={[{backgroundColor:bg[variant],borderRadius:10,paddingVertical:small?7:11,paddingHorizontal:small?12:18,alignItems:"center",justifyContent:"center",borderWidth:variant==="ghost"?1.5:0,borderColor:C.gold},style]}>
      <Text style={{color:tc[variant],fontWeight:"700",fontSize:small?12:14}}>{children}</Text>
    </TouchableOpacity>
  );
}
function Input({ label, style, ...props }) {
  return (
    <View style={{marginBottom:12}}>
      {label && <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:5,textTransform:"uppercase",letterSpacing:0.5}}>{label}</Text>}
      <TextInput style={[{backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,fontSize:14,color:C.white},style]} placeholderTextColor={C.gray} {...props}/>
    </View>
  );
}
function ModalWrapper({ open, onClose, title, children }) {
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
        <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:18,borderBottomWidth:1,borderBottomColor:C.border}}>
          <GoldText style={{fontSize:18}}>{title}</GoldText>
          <TouchableOpacity onPress={onClose}><Text style={{color:C.gray,fontSize:22}}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView style={{padding:18}}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
function EquipeSelector({ currentEquipe, onSelect }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{paddingHorizontal:14,paddingVertical:10}}>
      {EQUIPES.map(eq=>{
        const isSel=currentEquipe===eq.id;
        return (
          <TouchableOpacity key={eq.id} onPress={()=>onSelect(eq.id)}
            style={{marginRight:10,paddingHorizontal:14,paddingVertical:10,borderRadius:14,backgroundColor:isSel?eq.color+"30":C.card,borderWidth:2,borderColor:isSel?eq.color:C.border,alignItems:"center",minWidth:90}}>
            <Image source={eq.logo} style={{width:36,height:36,borderRadius:18,resizeMode:"cover"}}/>
            <Text style={{color:isSel?eq.color:C.white,fontWeight:"800",fontSize:12,marginTop:2}}>{eq.label}</Text>
            <Text style={{color:C.gray,fontSize:10}}>{eq.subtitle}</Text>
            {isSel&&<View style={{width:20,height:3,borderRadius:2,backgroundColor:eq.color,marginTop:4}}/>}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── BADGE RÔLE ──────────────────────────────────────────────────────────────
function RoleBadge({ user }) {
  const role = getRole(user);
  if (role === "coach") return (
    <View style={{flexDirection:"row",alignItems:"center",gap:4}}>
      <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>👑 Coach Principal</Text>
    </View>
  );
  if (role === "adjoint") return (
    <View style={{flexDirection:"row",alignItems:"center",gap:4}}>
      <Text style={{color:C.orange,fontSize:12,fontWeight:"700"}}>🎽 Coach Adjoint</Text>
    </View>
  );
  return (
    <View style={{flexDirection:"row",alignItems:"center",gap:4}}>
      <Text style={{color:C.primaryLight,fontSize:12,fontWeight:"700"}}>👪 Parent</Text>
    </View>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail]=useState("");
  const [password, setPassword]=useState("");
  const [isRegister, setIsRegister]=useState(false);
  const [loading, setLoading]=useState(false);
  const [error, setError]=useState("");
  const [resetSent, setResetSent]=useState(false);

  async function handleResetPassword() {
    if(!email.trim()) { setError("Entrez votre email pour réinitialiser le mot de passe."); return; }
    setLoading(true); setError("");
    try {
      const r=await fetch(`${AUTH_URL}:sendOobCode?key=${FB_API_KEY}`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({requestType:'PASSWORD_RESET',email:email.trim()}),
      });
      const d=await r.json();
      if(d.error) throw new Error(d.error.message);
      setResetSent(true);
    } catch(e) {
      setError("Email introuvable ou invalide.");
    }
    setLoading(false);
  }

  async function handleAuth() {
    if(!email.trim()||!password.trim()){setError("Veuillez remplir tous les champs.");return;}
    setLoading(true);setError("");
    try {
      let u;
      if(isRegister) u=await signUp(email.trim(),password);
      else u=await signIn(email.trim(),password);
      const isCoach=u.email===COACH_EMAIL;
      // Vérifier si l'utilisateur est coach adjoint dans Firestore
      let isAdjoint=false;
      let adjointPerms={};
      if(!isCoach) {
        try {
          const adjoints = await fbGet('adjoints');
          const adj = adjoints.find(a=>a.email===u.email);
          if(adj) { isAdjoint=true; adjointPerms=adj.perms||{}; }
        } catch(e) {}
      }
      setFbToken(u.idToken);
      const userData={
        email:u.email,
        name:u.displayName||u.email.split('@')[0],
        isCoach,
        isAdjoint,
        adjointPerms,
        token:u.idToken,
        refreshToken:u.refreshToken,
        tokenTime:Date.now(),
      };
      await AsyncStorage.setItem('lhb_user',JSON.stringify(userData));
      onLogin(userData);
    } catch(e) {
      const msg=e.message.includes('EMAIL_NOT_FOUND')?"Email introuvable.":
                e.message.includes('WRONG_PASSWORD')?"Mot de passe incorrect.":
                e.message.includes('INVALID_PASSWORD')?"Mot de passe incorrect.":
                e.message.includes('EMAIL_EXISTS')?"Email déjà utilisé.":
                e.message.includes('WEAK_PASSWORD')?"Mot de passe trop faible (6 min).":"Erreur de connexion.";
      setError(msg);
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:"center",padding:24}}>
        <View style={{alignItems:"center",marginBottom:32}}>
          <Image source={require('./assets/LogoLHB.png')} style={{width:120,height:120,resizeMode:"contain",marginBottom:16}}/>
          <GoldText style={{fontSize:32,letterSpacing:2}}>Lescar Handball</GoldText>
          <Text style={{color:C.gray,fontSize:14,marginTop:4}}>-15F · Saison 2026-2027</Text>
        </View>
        <Card>
          <GoldText style={{fontSize:20,marginBottom:20,textAlign:"center"}}>{isRegister?"Créer un compte":"Connexion"}</GoldText>
          {error?<View style={{backgroundColor:"#2A0A0A",borderRadius:10,padding:12,marginBottom:14}}><Text style={{color:C.red,fontSize:13,textAlign:"center"}}>{error}</Text></View>:null}
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="votre@email.com" keyboardType="email-address" autoCapitalize="none"/>
          <Input label="Mot de passe" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry/>
          <Btn onPress={handleAuth} style={{marginTop:8}}>{loading?"Connexion…":isRegister?"Créer le compte":"Se connecter"}</Btn>
          <TouchableOpacity onPress={()=>{setIsRegister(!isRegister);setError("");setResetSent(false);}} style={{marginTop:16,alignItems:"center"}}>
            <Text style={{color:C.gray,fontSize:13}}>{isRegister?"Déjà un compte ? ":"Pas encore de compte ? "}
              <Text style={{color:C.gold,fontWeight:"700"}}>{isRegister?"Se connecter":"S'inscrire"}</Text>
            </Text>
          </TouchableOpacity>
          {!isRegister&&(
            resetSent?(
              <View style={{marginTop:12,padding:12,backgroundColor:"#0A2A1A",borderRadius:10,borderWidth:1,borderColor:C.green}}>
                <Text style={{color:C.green,fontSize:13,textAlign:"center",fontWeight:"700"}}>✅ Email envoyé ! Vérifiez votre boîte mail pour réinitialiser votre mot de passe.</Text>
              </View>
            ):(
              <TouchableOpacity onPress={handleResetPassword} style={{marginTop:10,alignItems:"center"}}>
                <Text style={{color:C.primaryLight,fontSize:13}}>Mot de passe oublié ?</Text>
              </TouchableOpacity>
            )
          )}
        </Card>
        <View style={{marginTop:16,padding:14,backgroundColor:C.primary+"20",borderRadius:12,borderWidth:1,borderColor:C.primary}}>
          <Text style={{color:C.gray,fontSize:12,textAlign:"center",lineHeight:18}}>
            🏆 <Text style={{color:C.gold,fontWeight:"700"}}>Coach principal</Text> : connectez-vous avec votre email habituel 
            🎽 <Text style={{color:C.orange,fontWeight:"700"}}>Coachs adjoints</Text> : connectez-vous avec votre email 
            👪 <Text style={{color:C.primaryLight,fontWeight:"700"}}>Parents</Text> : créez un compte avec votre email
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ players, events, currentEquipe, onEquipeChange, user, infos, setInfos, reloadAll }) {
  const [refreshing, setRefreshing]=useState(false);
  async function handleRefresh() { setRefreshing(true); await reloadAll(); setTimeout(()=>setRefreshing(false),500); }
  const eq=EQUIPES.find(e=>e.id===currentEquipe);
  const today=new Date();
  const evList=events.filter(e=>e.equipe===currentEquipe);
  const upcoming=evList.filter(e=>new Date(e.date)>=today).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,3);
  const nextMatch=evList.filter(e=>e.type==="match"&&new Date(e.date)>=today).sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe));
  const presentCount=teamPlayers.filter(p=>p.present).length;
  const role=getRole(user);
  const canManageInfos=role==="coach"||(role==="adjoint"); // coach + tous adjoints peuvent gérer les infos
  const [showInfoModal, setShowInfoModal]=useState(false);
  const [editInfo, setEditInfo]=useState(null);
  const [infoForm, setInfoForm]=useState({texte:"",auteur:""});

  function openAddInfo() { setInfoForm({texte:"",auteur:user.name}); setEditInfo(null); setShowInfoModal(true); }
  function openEditInfo(info) { setInfoForm({texte:info.texte,auteur:info.auteur}); setEditInfo(info); setShowInfoModal(true); }

  async function saveInfo() {
    if(!infoForm.texte?.trim()) return;
    const id=editInfo?editInfo._id:Date.now().toString();
    const data={texte:infoForm.texte.trim(),auteur:user.name,date:todayFmt()};
    await fbSet('infos',id,data);
    if(editInfo) setInfos(is=>is.map(i=>i._id===editInfo._id?{...data,_id:id}:i));
    else setInfos(is=>[...is,{...data,_id:id}]);
    setShowInfoModal(false);
  }

  function delInfo(info) {
    Alert.alert("Supprimer","Supprimer cette info importante ?",[
      {text:"Annuler",style:"cancel"},
      {text:"Supprimer",style:"destructive",onPress:()=>{
        fbDel('infos',info._id);
        setInfos(is=>is.filter(i=>i._id!==info._id));
      }}
    ]);
  }

  return (
    <ScrollView style={{flex:1,backgroundColor:C.bg}} showsVerticalScrollIndicator={false}>
      <View style={{backgroundColor:C.card2,padding:24,paddingTop:16,paddingBottom:24,borderBottomWidth:1,borderBottomColor:C.border}}>
        <View style={{flexDirection:"row",alignItems:"center",gap:10,marginBottom:6}}>
          <Text style={{color:C.gray,fontSize:12,fontWeight:"700",letterSpacing:2,textTransform:"uppercase"}}>🏐 LESCAR HANDBALL</Text>
          <Image source={require('./assets/LogoLHB.png')} style={{width:120,height:120,resizeMode:'contain'}}/>
        </View>
        <Text style={{fontSize:42,letterSpacing:2,fontWeight:"800",color:C.primary}}>-15F</Text>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
          <Text style={{color:C.gray,fontSize:13,fontWeight:"600",marginBottom:8}}>SAISON 2026 – 2027</Text>
          <TouchableOpacity onPress={handleRefresh}
            style={{backgroundColor:C.card,borderRadius:20,paddingHorizontal:12,paddingVertical:6,flexDirection:"row",alignItems:"center",gap:6,borderWidth:1,borderColor:C.border}}>
            <Text style={{fontSize:14}}>{refreshing?"⏳":"🔄"}</Text>
            <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>Actualiser</Text>
          </TouchableOpacity>
        </View>
        <View style={{flexDirection:"row",alignItems:"center",gap:8,marginBottom:16}}>
          <View style={{width:8,height:8,borderRadius:4,backgroundColor:role==="coach"?C.gold:role==="adjoint"?C.orange:C.green}}/>
          <Text style={{color:role==="coach"?C.gold:role==="adjoint"?C.orange:C.green,fontSize:12,fontWeight:"700"}}>
            {role==="coach"?"👑 Coach Principal — Stéphane Bardyn":role==="adjoint"?"🎽 Coach Adjoint — "+user.name:"👪 "+user.name}
          </Text>
        </View>

        {/* ── INFOS IMPORTANTES ── */}
        {(infos.length>0||canManageInfos)&&(
          <View style={{marginBottom:16}}>
            <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <View style={{flexDirection:"row",alignItems:"center",gap:6}}>
                <Text style={{fontSize:16}}>🚨</Text>
                <Text style={{color:"#FF4444",fontWeight:"900",fontSize:13,letterSpacing:1,textTransform:"uppercase"}}>Info importante</Text>
              </View>
              {canManageInfos&&(
                <TouchableOpacity onPress={openAddInfo}
                  style={{backgroundColor:"#FF444425",borderRadius:20,paddingHorizontal:12,paddingVertical:5,borderWidth:1.5,borderColor:"#FF4444"}}>
                  <Text style={{color:"#FF4444",fontWeight:"800",fontSize:12}}>+ Ajouter</Text>
                </TouchableOpacity>
              )}
            </View>
            {infos.length===0&&canManageInfos&&(
              <View style={{padding:12,borderRadius:12,backgroundColor:"#FF444410",borderWidth:1,borderStyle:"dashed",borderColor:"#FF444450",alignItems:"center"}}>
                <Text style={{color:"#FF444480",fontSize:12}}>Aucune info pour le moment</Text>
              </View>
            )}
            {infos.map((info,idx)=>(
              <View key={info._id} style={{
                borderRadius:14,padding:14,marginBottom:8,
                backgroundColor:"#1A0A0A",
                borderWidth:2,borderColor:"#FF4444",
                borderLeftWidth:5,borderLeftColor:"#FF4444",
              }}>
                <View style={{flexDirection:"row",alignItems:"flex-start",gap:10}}>
                  <Text style={{fontSize:20,marginTop:1}}>🚨</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:"#FF6666",fontWeight:"900",fontSize:11,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>
                      INFO IMPORTANTE !!!
                    </Text>
                    <Text style={{color:"#FFFFFF",fontSize:15,fontWeight:"700",lineHeight:22}}>{info.texte}</Text>
                    <Text style={{color:"#FF444480",fontSize:11,marginTop:6}}>
                      Publié par {info.auteur} · {info.date}
                    </Text>
                  </View>
                  {canManageInfos&&(
                    <View style={{gap:6}}>
                      <TouchableOpacity onPress={()=>openEditInfo(info)}
                        style={{backgroundColor:"#2A1A1A",borderRadius:8,padding:7,borderWidth:1,borderColor:"#FF444440"}}>
                        <Text style={{fontSize:13}}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={()=>delInfo(info)}
                        style={{backgroundColor:"#2A0A0A",borderRadius:8,padding:7,borderWidth:1,borderColor:"#FF444440"}}>
                        <Text style={{fontSize:13}}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {nextMatch&&(
          <View style={{backgroundColor:"rgba(108,63,197,0.2)",borderRadius:14,padding:14,borderWidth:1,borderColor:C.primary}}>
            <Text style={{color:C.gold,fontSize:10,fontWeight:"700",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>⚔️ PROCHAIN MATCH · {eq.label}</Text>
            <Text style={{color:C.white,fontSize:17,fontWeight:"800"}}>vs {nextMatch.adversaire}</Text>
            <Text style={{color:"rgba(255,255,255,0.75)",fontSize:12,marginTop:2}}>{fmt(nextMatch.date)} à {nextMatch.heure} · {nextMatch.lieu}</Text>
            <View style={{marginTop:8,backgroundColor:"rgba(255,215,0,0.15)",borderRadius:20,alignSelf:"flex-start",paddingHorizontal:10,paddingVertical:4}}>
              <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>{nextMatch.domicile==="true"?"🏠 Domicile":"✈️ Extérieur"}</Text>
            </View>
          </View>
        )}
      </View>

      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <View style={{paddingHorizontal:14}}>
        <View style={{flexDirection:"row",gap:10,marginBottom:14}}>
          {[
            {label:"Joueuses",val:teamPlayers.length,icon:"👥",color:eq.color},
            {label:"Présentes",val:presentCount,icon:"✅",color:C.green},
            {label:"Événements",val:upcoming.length,icon:"📅",color:C.gold},
          ].map(s=>(
            <Card key={s.label} style={{flex:1,alignItems:"center",padding:12}}>
              <Text style={{fontSize:22}}>{s.icon}</Text>
              <Text style={{fontSize:24,fontWeight:"900",color:s.color,marginTop:2}}>{s.val}</Text>
              <Text style={{fontSize:10,color:C.gray,fontWeight:"700",textTransform:"uppercase"}}>{s.label}</Text>
            </Card>
          ))}
        </View>
        <Card style={{marginBottom:100}}>
          <GoldText style={{fontSize:15,marginBottom:12}}>Prochains événements · {eq.label}</GoldText>
          {upcoming.length===0?<Text style={{color:C.gray,fontSize:13}}>Aucun événement à venir.</Text>:upcoming.map(ev=>{
            const tc=TYPE_CONFIG[ev.type]||TYPE_CONFIG.entrainement;
            return (
              <View key={ev._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:tc.light,borderLeftWidth:4,borderLeftColor:tc.color,marginBottom:8}}>
                <Text style={{fontSize:18}}>{tc.icon}</Text>
                <View style={{flex:1}}>
                  <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>{ev.title}</Text>
                  <Text style={{color:C.gray,fontSize:11,marginTop:1}}>{fmt(ev.date)} à {ev.heure}</Text>
                </View>
                <View style={{backgroundColor:tc.color+"30",borderRadius:20,paddingHorizontal:8,paddingVertical:3}}>
                  <Text style={{color:tc.color,fontSize:10,fontWeight:"700"}}>{tc.label}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      </View>

      {/* MODAL AJOUT/ÉDITION INFO */}
      <Modal visible={showInfoModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setShowInfoModal(false)}>
        <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
          <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:18,borderBottomWidth:1,borderBottomColor:"#FF444430"}}>
            <Text style={{color:"#FF4444",fontWeight:"900",fontSize:18}}>🚨 {editInfo?"Modifier":"Nouvelle"} info importante</Text>
            <TouchableOpacity onPress={()=>setShowInfoModal(false)}><Text style={{color:C.gray,fontSize:22}}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView style={{padding:18}}>
            <Text style={{color:"#FF6666",fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Message</Text>
            <TextInput
              value={infoForm.texte}
              onChangeText={v=>setInfoForm(f=>({...f,texte:v}))}
              placeholder="Ex: Entraînement annulé ce jeudi, RDV vendredi à 18h…"
              placeholderTextColor="#FF444450"
              multiline
              style={{backgroundColor:"#1A0A0A",borderWidth:2,borderColor:"#FF444440",borderRadius:12,padding:14,fontSize:15,color:C.white,minHeight:120,lineHeight:22}}
            />
            <View style={{padding:12,borderRadius:10,backgroundColor:"#FF444415",borderWidth:1,borderColor:"#FF444430",marginTop:12,marginBottom:24}}>
              <Text style={{color:"#FF666680",fontSize:12,lineHeight:18}}>
                💡 Ce message sera affiché en rouge en haut de l'écran d'accueil pour tous les membres, jusqu'à sa suppression manuelle.
              </Text>
            </View>
            <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
              <TouchableOpacity onPress={()=>setShowInfoModal(false)}
                style={{flex:1,padding:12,borderRadius:10,backgroundColor:C.card2,alignItems:"center",borderWidth:1,borderColor:C.border}}>
                <Text style={{color:C.gray,fontWeight:"700"}}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveInfo}
                style={{flex:1,padding:12,borderRadius:10,backgroundColor:"#FF444425",alignItems:"center",borderWidth:2,borderColor:"#FF4444"}}>
                <Text style={{color:"#FF4444",fontWeight:"900"}}>🚨 {editInfo?"Modifier":"Publier"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

// ─── JOUEURS ─────────────────────────────────────────────────────────────────
function Players({ players, setPlayers, currentEquipe, onEquipeChange, loading, user }) {
  const [search, setSearch]=useState("");
  const [showModal, setShowModal]=useState(false);
  const [editP, setEditP]=useState(null);
  const [form, setForm]=useState({});
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe));
  const filtered=teamPlayers.filter(p=>(p.name||"").toLowerCase().includes(search.toLowerCase()));
  const eq=EQUIPES.find(e=>e.id===currentEquipe);
  const canEdit=can(user,"managePlayers");

  function openAdd() { setForm({name:"",num:"",poste:POSTES[0],age:"",equipes:[currentEquipe,"groupe"]}); setEditP(null); setShowModal(true); }
  function openEdit(p) { setForm({...p}); setEditP(p); setShowModal(true); }
  async function save() {
    if(!form.name?.trim()) return Alert.alert("Erreur","Le prénom est obligatoire.");
    const av=form.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    const equipes=Array.isArray(form.equipes)?form.equipes:[currentEquipe,"groupe"];
    if(!equipes.includes("groupe")) equipes.push("groupe");
    const id=editP?editP._id:Date.now().toString();
    const data={...form,avatar:av,present:editP?editP.present:true,equipes,presences:editP?editP.presences||{}:{}};
    await fbSet('players',id,data);
    if(editP) setPlayers(ps=>ps.map(p=>p._id===editP._id?{...data,_id:id}:p));
    else setPlayers(ps=>[...ps,{...data,_id:id}]);
    setShowModal(false);
  }
  async function del(p) {
    Alert.alert("Supprimer","Confirmer ?",[{text:"Annuler",style:"cancel"},{text:"Supprimer",style:"destructive",onPress:async()=>{
      await fbDel('players',p._id); setPlayers(ps=>ps.filter(x=>x._id!==p._id));
    }}]);
  }
  async function toggle(p) {
    if(!canEdit) return;
    const updated={...p,present:!p.present};
    await fbSet('players',p._id,updated);
    setPlayers(ps=>ps.map(x=>x._id===p._id?updated:x));
  }
  async function toggleEquipe(p, equipeId) {
    if(!canEdit) return;
    const equipes=Array.isArray(p.equipes)?[...p.equipes]:[];
    const newEq=equipes.includes(equipeId)?equipes.filter(e=>e!==equipeId):[...equipes,equipeId];
    if(!newEq.includes("groupe")) newEq.push("groupe");
    const updated={...p,equipes:newEq};
    await fbSet('players',p._id,updated);
    setPlayers(ps=>ps.map(x=>x._id===p._id?updated:x));
  }

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border}}>
        <GoldText style={{fontSize:28}}>Équipe</GoldText>
        <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <View style={{flexDirection:"row",gap:10,paddingHorizontal:14,paddingBottom:10}}>
        <TextInput value={search} onChangeText={setSearch} placeholder="🔍 Rechercher…" placeholderTextColor={C.gray}
          style={{flex:1,backgroundColor:C.card,borderWidth:1.5,borderColor:C.border,borderRadius:12,padding:10,color:C.white,fontSize:14}}/>
        {canEdit&&<Btn small onPress={openAdd}>+ Ajouter</Btn>}
      </View>
      {loading?<ActivityIndicator color={C.gold} size="large" style={{marginTop:40}}/>:(
        <FlatList data={filtered} keyExtractor={p=>p._id} contentContainerStyle={{paddingHorizontal:14,paddingBottom:100}}
          ItemSeparatorComponent={()=><View style={{height:8}}/>}
          ListHeaderComponent={()=>(
            <View style={{flexDirection:"row",alignItems:"center",marginBottom:10}}>
              <View style={{width:8,height:8,borderRadius:4,backgroundColor:eq.color,marginRight:6}}/>
              <Text style={{color:eq.color,fontWeight:"700",fontSize:13}}>{eq.label} — {filtered.length} joueuses</Text>
            </View>
          )}
          renderItem={({item:p})=>(
            <Card style={{marginBottom:0}}>
              <View style={{flexDirection:"row",alignItems:"center",gap:12}}>
                <Avatar initials={p.avatar||"??"} size={46}/>
                <View style={{flex:1}}>
                  <View style={{flexDirection:"row",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <Text style={{color:C.white,fontWeight:"700",fontSize:15}}>{p.name}</Text>
                    <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>#{p.num}</Text>
                  </View>
                  <Text style={{color:C.primaryLight,fontSize:12,fontWeight:"600",marginTop:1}}>{p.poste}</Text>
                  {canEdit&&(
                    <View style={{flexDirection:"row",gap:6,marginTop:6,flexWrap:"wrap"}}>
                      {["equipe1","equipe2"].map(eqId=>{
                        const eqInfo=EQUIPES.find(e=>e.id===eqId);
                        const isIn=Array.isArray(p.equipes)&&p.equipes.includes(eqId);
                        return (
                          <TouchableOpacity key={eqId} onPress={()=>toggleEquipe(p,eqId)}
                            style={{paddingHorizontal:8,paddingVertical:4,borderRadius:20,backgroundColor:isIn?eqInfo.color+"30":C.card2,borderWidth:1,borderColor:isIn?eqInfo.color:C.border}}>
                            <Text style={{color:isIn?eqInfo.color:C.gray,fontSize:11,fontWeight:"700"}}>{eqInfo.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  <View style={{flexDirection:"row",gap:8,marginTop:8,alignItems:"center"}}>
                    <TouchableOpacity onPress={()=>toggle(p)} disabled={!canEdit}
                      style={{backgroundColor:p.present?"#0A2A1A":"#2A0A0A",borderRadius:20,paddingHorizontal:10,paddingVertical:4}}>
                      <Text style={{color:p.present?C.green:C.red,fontSize:12,fontWeight:"700"}}>{p.present?"✓ Présente":"✗ Absente"}</Text>
                    </TouchableOpacity>
                    {canEdit&&<>
                      <TouchableOpacity onPress={()=>openEdit(p)} style={{backgroundColor:C.card2,borderRadius:8,padding:6}}><Text>✏️</Text></TouchableOpacity>
                      <TouchableOpacity onPress={()=>del(p)} style={{backgroundColor:"#2A0A0A",borderRadius:8,padding:6}}><Text>🗑️</Text></TouchableOpacity>
                    </>}
                  </View>
                </View>
              </View>
            </Card>
          )}
        />
      )}
      {canEdit&&(
        <ModalWrapper open={showModal} onClose={()=>setShowModal(false)} title={editP?"Modifier":"Ajouter une joueuse"}>
          <Input label="Prénom" value={form.name||""} onChangeText={v=>setForm(f=>({...f,name:v}))} placeholder="Prénom"/>
          <View style={{flexDirection:"row",gap:10}}>
            <View style={{flex:1}}><Input label="Numéro" value={String(form.num||"")} onChangeText={v=>setForm(f=>({...f,num:v}))} keyboardType="numeric"/></View>
            <View style={{flex:1}}><Input label="Âge" value={String(form.age||"")} onChangeText={v=>setForm(f=>({...f,age:v}))} keyboardType="numeric"/></View>
          </View>
          <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase"}}>Poste</Text>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:14}}>
            {POSTES.map(p=>(
              <TouchableOpacity key={p} onPress={()=>setForm(f=>({...f,poste:p}))}
                style={{paddingHorizontal:12,paddingVertical:7,borderRadius:20,backgroundColor:form.poste===p?C.primary:C.card2,borderWidth:1,borderColor:form.poste===p?C.primaryLight:C.border}}>
                <Text style={{color:form.poste===p?C.white:C.gray,fontWeight:"700",fontSize:13}}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase"}}>Équipes</Text>
          <View style={{flexDirection:"row",gap:10,marginBottom:14}}>
            {["equipe1","equipe2"].map(eqId=>{
              const eqInfo=EQUIPES.find(e=>e.id===eqId);
              const isIn=(form.equipes||[]).includes(eqId);
              return (
                <TouchableOpacity key={eqId} onPress={()=>{
                  const eq=form.equipes||[];
                  setForm(f=>({...f,equipes:isIn?eq.filter(e=>e!==eqId):[...eq,eqId]}));
                }} style={{flex:1,paddingVertical:10,borderRadius:12,backgroundColor:isIn?eqInfo.color+"30":C.card2,borderWidth:2,borderColor:isIn?eqInfo.color:C.border,alignItems:"center"}}>
                  <Text style={{color:isIn?eqInfo.color:C.gray,fontWeight:"700",fontSize:13}}>{eqInfo.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Input label="Prénom Parent 1" value={form.parent1||""} onChangeText={v=>setForm(f=>({...f,parent1:v}))} placeholder="Prénom parent 1"/>
          <Input label="Email Parent 1" value={form.emailParent1||""} onChangeText={v=>setForm(f=>({...f,emailParent1:v.toLowerCase()}))} placeholder="email@exemple.com" keyboardType="email-address" autoCapitalize="none"/>
          <Input label="Prénom Parent 2 (optionnel)" value={form.parent2||""} onChangeText={v=>setForm(f=>({...f,parent2:v}))} placeholder="Prénom parent 2"/>
          <Input label="Email Parent 2 (optionnel)" value={form.emailParent2||""} onChangeText={v=>setForm(f=>({...f,emailParent2:v.toLowerCase()}))} placeholder="email@exemple.com" keyboardType="email-address" autoCapitalize="none"/>
          <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
            <Btn variant="secondary" onPress={()=>setShowModal(false)} style={{flex:1}}>Annuler</Btn>
            <Btn onPress={save} style={{flex:1}}>Enregistrer</Btn>
          </View>
        </ModalWrapper>
      )}
    </SafeAreaView>
  );
}

// ─── CALENDRIER ──────────────────────────────────────────────────────────────
function CalendarView({ events, setEvents, currentEquipe, onEquipeChange, user, taches }) {
  const today=new Date();
  const [year, setYear]=useState(2026);
  const [month, setMonth]=useState(8);
  const [selDay, setSelDay]=useState(null);
  const [showForm, setShowForm]=useState(false);
  const [editEv, setEditEv]=useState(null);
  const [form, setForm]=useState({});
  const [showRoles, setShowRoles]=useState(null);
  const daysInMonth=getDays(year,month);
  const firstDay=getFirst(year,month);
  const tStr=todayStr();
  const evList=events.filter(e=>e.equipe===currentEquipe);
  const eq=EQUIPES.find(e=>e.id===currentEquipe);
  const canEdit=can(user,"editCalendar");
  const canInscription=can(user,"inscriptionRole");
  // Rôles = tâches du coach + rôles par défaut
  const ROLES_LIST=ROLES_LIST_DEFAULT;

  function evOnDay(d) {
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return evList.filter(e=>e.date===ds);
  }
  function prevM() { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }
  function nextM() { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }
  function openAdd(day) {
    if(!canEdit) return;
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    setForm({type:"entrainement",title:"",date:ds,heure:"18:00",lieu:"",adversaire:"",domicile:"true",note:"",equipe:currentEquipe,roles:{}});
    setEditEv(null); setShowForm(true);
  }
  function openEdit(ev) { if(!canEdit) return; setForm({...ev,roles:ev.roles||{}}); setEditEv(ev); setShowForm(true); }
  async function save() {
    if(!form.title?.trim()) return;
    const id=editEv?editEv._id:Date.now().toString();
    const data={...form,equipe:currentEquipe};
    await fbSet('events',id,data);
    if(editEv) setEvents(es=>es.map(e=>e._id===editEv._id?{...data,_id:id}:e));
    else setEvents(es=>[...es,{...data,_id:id}]);
    setShowForm(false);
  }
  async function del(ev) {
    if(!canEdit) return;
    await fbDel('events',ev._id);
    setEvents(es=>es.filter(e=>e._id!==ev._id));
  }
  async function inscriptionRole(ev, role) {
    if(!canInscription) return;
    const roles=ev.roles||{};
    const currentVal=roles[role]||"";
    const userName=user.name;
    const newVal=currentVal===userName?"":userName;
    const updatedRoles={...roles,[role]:newVal};
    const updated={...ev,roles:updatedRoles};
    await fbSet('events',ev._id,updated);
    setEvents(es=>es.map(e=>e._id===ev._id?updated:e));
    if(showRoles) setShowRoles(updated);
  }

  const monthEvents=evList.filter(e=>e.date&&e.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).sort((a,b)=>a.date.localeCompare(b.date));

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border}}>
        <GoldText style={{fontSize:28}}>Agenda</GoldText>
        <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:14,marginBottom:10}}>
          <TouchableOpacity onPress={prevM} style={{backgroundColor:C.card,borderRadius:10,width:36,height:36,alignItems:"center",justifyContent:"center"}}>
            <Text style={{color:C.gold,fontSize:18,fontWeight:"700"}}>‹</Text>
          </TouchableOpacity>
          <GoldText style={{fontSize:20}}>{MONTHS[month]} {year}</GoldText>
          <TouchableOpacity onPress={nextM} style={{backgroundColor:C.card,borderRadius:10,width:36,height:36,alignItems:"center",justifyContent:"center"}}>
            <Text style={{color:C.gold,fontSize:18,fontWeight:"700"}}>›</Text>
          </TouchableOpacity>
        </View>
        <Card style={{marginHorizontal:14}}>
          <View style={{flexDirection:"row",marginBottom:6}}>
            {DAYS_SHORT.map((d,i)=><Text key={i} style={{flex:1,textAlign:"center",color:C.gold,fontSize:11,fontWeight:"700"}}>{d}</Text>)}
          </View>
          <View style={{flexDirection:"row",flexWrap:"wrap"}}>
            {Array(firstDay).fill(null).map((_,i)=><View key={"e"+i} style={{width:"14.28%"}}/>)}
            {Array(daysInMonth).fill(null).map((_,i)=>{
              const d=i+1;
              const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
              const evs=evOnDay(d);
              const isToday=ds===tStr;
              const isSel=selDay===d;
              return (
                <TouchableOpacity key={d} onPress={()=>setSelDay(isSel?null:d)}
                  style={{width:"14.28%",alignItems:"center",paddingVertical:6,borderRadius:8,backgroundColor:isSel?C.primary:isToday?"#1A1A3A":"transparent",borderWidth:isToday&&!isSel?1:0,borderColor:C.gold}}>
                  <Text style={{fontSize:13,fontWeight:isToday||isSel?"800":"400",color:isSel?C.white:isToday?C.gold:C.white}}>{d}</Text>
                  <View style={{flexDirection:"row",gap:2,marginTop:2}}>
                    {evs.slice(0,3).map(ev=><View key={ev._id} style={{width:5,height:5,borderRadius:3,backgroundColor:isSel?C.white:TYPE_CONFIG[ev.type]?.color||C.gray}}/>)}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>
        {selDay&&(
          <Card style={{marginHorizontal:14}}>
            <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <GoldText style={{fontSize:15}}>{selDay} {MONTHS[month]}</GoldText>
              {canEdit&&<Btn small onPress={()=>openAdd(selDay)}>+ Ajouter</Btn>}
            </View>
            {evOnDay(selDay).length===0?<Text style={{color:C.gray,fontSize:13}}>Aucun événement ce jour.</Text>:evOnDay(selDay).map(ev=>{
              const tc=TYPE_CONFIG[ev.type]||TYPE_CONFIG.entrainement;
              return (
                <View key={ev._id} style={{padding:10,borderRadius:10,backgroundColor:tc.light,borderLeftWidth:3,borderLeftColor:tc.color,marginBottom:6}}>
                  <View style={{flexDirection:"row",alignItems:"center",gap:10}}>
                    <Text style={{fontSize:18}}>{tc.icon}</Text>
                    <View style={{flex:1}}>
                      <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>{ev.title}</Text>
                      <Text style={{color:C.gray,fontSize:11}}>{ev.heure} · {ev.lieu}</Text>
                    </View>
                    {canEdit&&<>
                      <TouchableOpacity onPress={()=>openEdit(ev)} style={{padding:5}}><Text>✏️</Text></TouchableOpacity>
                      <TouchableOpacity onPress={()=>del(ev)} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
                    </>}
                  </View>
                  <TouchableOpacity onPress={()=>setShowRoles(ev)} style={{marginTop:8,backgroundColor:C.primary+"20",borderRadius:8,padding:8,flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
                    <Text style={{color:C.primaryLight,fontSize:12,fontWeight:"700"}}>👥 Voir/S'inscrire aux rôles</Text>
                    <Text style={{color:C.gold,fontSize:12}}>→</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </Card>
        )}
        <View style={{paddingHorizontal:14,marginBottom:14}}>
          <GoldText style={{fontSize:15,marginBottom:10}}>🔗 Championnats FFHB</GoldText>
          <TouchableOpacity onPress={()=>Linking.openURL(LIEN_E1)}
            style={{flexDirection:"row",alignItems:"center",gap:10,padding:14,borderRadius:12,backgroundColor:"#3B82F620",borderWidth:1.5,borderColor:"#3B82F6",marginBottom:10}}>
            <Image source={require('./assets/Horacek.jpg')} style={{width:36,height:36,borderRadius:18,resizeMode:"cover"}}/>
            <View style={{flex:1}}>
              <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>Championnat Équipe 1</Text>
              <Text style={{color:C.gray,fontSize:11,marginTop:2}}>Voir sur FFHB →</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>Linking.openURL(LIEN_E2)}
            style={{flexDirection:"row",alignItems:"center",gap:10,padding:14,borderRadius:12,backgroundColor:"#EF444420",borderWidth:1.5,borderColor:"#EF4444",marginBottom:14}}>
            <Image source={require('./assets/Sako.jpg')} style={{width:36,height:36,borderRadius:18,resizeMode:"cover"}}/>
            <View style={{flex:1}}>
              <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>Championnat Équipe 2</Text>
              <Text style={{color:C.gray,fontSize:11,marginTop:2}}>Voir sur FFHB →</Text>
            </View>
          </TouchableOpacity>
          <View style={{flexDirection:"row",alignItems:"center",gap:8,marginBottom:10}}>
            <View style={{width:8,height:8,borderRadius:4,backgroundColor:eq.color}}/>
            <GoldText style={{fontSize:15}}>Événements {eq.label} — {MONTHS[month]}</GoldText>
          </View>
          {monthEvents.length===0?<Text style={{color:C.gray,fontSize:13}}>Aucun événement ce mois.</Text>:monthEvents.map(ev=>{
            const tc=TYPE_CONFIG[ev.type]||TYPE_CONFIG.entrainement;
            return (
              <Card key={ev._id} style={{flexDirection:"row",alignItems:"center",gap:10,borderLeftWidth:4,borderLeftColor:tc.color}}>
                <Text style={{fontSize:20}}>{tc.icon}</Text>
                <View style={{flex:1}}>
                  <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>{ev.title}</Text>
                  <Text style={{color:C.gray,fontSize:11}}>{fmt(ev.date)} à {ev.heure}</Text>
                </View>
                <View style={{backgroundColor:tc.color+"25",borderRadius:20,paddingHorizontal:8,paddingVertical:3}}>
                  <Text style={{color:tc.color,fontSize:10,fontWeight:"700"}}>{tc.label}</Text>
                </View>
              </Card>
            );
          })}
        </View>
        <View style={{height:100}}/>
      </ScrollView>

      {/* MODAL RÔLES */}
      <ModalWrapper open={!!showRoles} onClose={()=>setShowRoles(null)} title={showRoles?.title||"Rôles"}>
        {showRoles&&(
          <>
            <Text style={{color:C.gray,fontSize:13,marginBottom:16}}>{fmt(showRoles.date)} à {showRoles.heure} · {showRoles.lieu}</Text>
            {ROLES_LIST.map(role=>{
              const assigned=(showRoles.roles||{})[role]||"";
              const isMe=assigned===user.name;
              const isFree=!assigned;
              return (
                <View key={role} style={{flexDirection:"row",alignItems:"center",gap:12,padding:12,borderRadius:12,backgroundColor:isMe?C.green+"20":isFree?C.card2:"#1A1A2E",borderWidth:1.5,borderColor:isMe?C.green:isFree?C.border:C.primary,marginBottom:10}}>
                  <View style={{width:40,height:40,borderRadius:20,backgroundColor:isMe?C.green+"30":C.card,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:isMe?C.green:C.border}}>
                    <Text style={{fontSize:20}}>{/\p{Emoji}/u.test(role[0])?role.split(' ')[0]:"📌"}</Text>
                  </View>
                  <View style={{flex:1}}>
                    <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>{/\p{Emoji}/u.test(role[0])?role.substring(role.indexOf(' ')+1):role}</Text>
                    <Text style={{color:isMe?C.green:assigned?C.primaryLight:C.gray,fontSize:12,marginTop:2}}>
                      {isMe?"✓ Vous êtes inscrit(e)":assigned?"👤 "+assigned:"Disponible"}
                    </Text>
                  </View>
                  {canInscription&&(isFree||isMe)&&(
                    <TouchableOpacity onPress={()=>inscriptionRole(showRoles,role)}
                      style={{backgroundColor:isMe?C.red+"20":C.green+"20",borderRadius:10,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:isMe?C.red:C.green}}>
                      <Text style={{color:isMe?C.red:C.green,fontWeight:"700",fontSize:12}}>{isMe?"Se désinscrire":"S'inscrire"}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            <View style={{height:40}}/>
          </>
        )}
      </ModalWrapper>

      {/* MODAL FORMULAIRE */}
      {canEdit&&(
        <ModalWrapper open={showForm} onClose={()=>setShowForm(false)} title={editEv?"Modifier":"Nouvel événement"}>
          <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase"}}>Type</Text>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:14}}>
            {Object.entries(TYPE_CONFIG).map(([k,v])=>(
              <TouchableOpacity key={k} onPress={()=>setForm(f=>({...f,type:k}))}
                style={{paddingHorizontal:12,paddingVertical:7,borderRadius:20,backgroundColor:form.type===k?v.color:C.card2,borderWidth:1,borderColor:form.type===k?v.color:C.border}}>
                <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>{v.icon} {v.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Titre" value={form.title||""} onChangeText={v=>setForm(f=>({...f,title:v}))}/>
          <View style={{flexDirection:"row",gap:10}}>
            <View style={{flex:1}}><Input label="Date" value={form.date||""} onChangeText={v=>setForm(f=>({...f,date:v}))} placeholder="AAAA-MM-JJ"/></View>
            <View style={{flex:1}}><Input label="Heure" value={form.heure||""} onChangeText={v=>setForm(f=>({...f,heure:v}))} placeholder="HH:MM"/></View>
          </View>
          <Input label="Lieu" value={form.lieu||""} onChangeText={v=>setForm(f=>({...f,lieu:v}))}/>
          {form.type==="match"&&<Input label="Adversaire" value={form.adversaire||""} onChangeText={v=>setForm(f=>({...f,adversaire:v}))}/>}
          <Input label="Notes" value={form.note||""} onChangeText={v=>setForm(f=>({...f,note:v}))} multiline style={{minHeight:70}}/>
          <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
            <Btn variant="secondary" onPress={()=>setShowForm(false)} style={{flex:1}}>Annuler</Btn>
            <Btn onPress={save} style={{flex:1}}>Enregistrer</Btn>
          </View>
        </ModalWrapper>
      )}
    </SafeAreaView>
  );
}

// ─── APPEL ───────────────────────────────────────────────────────────────────
function Presences({ players, setPlayers, events, currentEquipe, onEquipeChange, user }) {
  const today=new Date();
  const [year, setYear]=useState(today.getFullYear());
  const [month, setMonth]=useState(today.getMonth());
  const [selEv, setSelEv]=useState(null);
  const [history, setHistory]=useState([]);

  // Charger l'historique des présences + auto-refresh 10s
  async function loadHistory() {
    const h=await fbGet('presencesHistory');
    setHistory(h);
  }
  useEffect(()=>{
    loadHistory();
    const interval=setInterval(loadHistory, 10000);
    return ()=>clearInterval(interval);
  },[currentEquipe]);
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe));
  const canEdit=can(user,"managePresences");
  const role=getRole(user);
  const eq=EQUIPES.find(e=>e.id===currentEquipe);

  // Événements du mois sélectionné pour cette équipe
  const monthStr=`${year}-${String(month+1).padStart(2,"0")}`;
  const monthEvents=events.filter(e=>e.equipe===currentEquipe&&e.date&&e.date.startsWith(monthStr))
    .sort((a,b)=>a.date.localeCompare(b.date));

  const pCount=teamPlayers.filter(p=>getStatut(p)==="present").length;
  const aCount=teamPlayers.filter(p=>getStatut(p)==="absent").length;
  const rCount=teamPlayers.filter(p=>getStatut(p)==="retard").length;

  function canEditPlayer(p) {
    if(canEdit) return true;
    if(role==="parent") {
      const email=(user.email||"").toLowerCase().trim();
      const ep1=(p.emailParent1||"").toLowerCase().trim();
      const ep2=(p.emailParent2||"").toLowerCase().trim();
      const name=(user.name||"").toLowerCase().trim();
      const p1=(p.parent1||"").toLowerCase().trim();
      const p2=(p.parent2||"").toLowerCase().trim();
      // Vérification par email OU par prénom (fallback)
      return (ep1&&ep1===email)||(ep2&&ep2===email)||
             (p1&&p1===name)||(p2&&p2===name);
    }
    return false;
  }

  async function setStatut(p, statut) {
    if(!canEditPlayer(p)) return;
    const updated={...p, statut, present: statut==="present"};
    await fbSet('players',p._id,updated);
    setPlayers(ps=>ps.map(x=>x._id===p._id?updated:x));
    const evId=selEv?selEv._id:todayStr().replace(/-/g,"");
    const evDate=selEv?selEv.date:todayStr();
    const evTitle=selEv?selEv.title:"Séance";
    const histId=evId+"_"+p._id;
    const entry={
      _id:histId, playerId:p._id, playerName:p.name,
      date:evDate, eventId:evId, eventTitle:evTitle,
      statut, equipes:Array.isArray(p.equipes)?p.equipes:[],
    };
    await fbSet('presencesHistory',histId,entry);
    // Mise à jour locale immédiate
    setHistory(hs=>{
      const filtered=hs.filter(h=>h._id!==histId);
      return [...filtered,entry];
    });
  }

  async function allPresent() {
    if(!canEdit||!selEv) return;
    const evId=selEv._id;
    const evDate=selEv.date;
    const newEntries=[];
    for(const p of teamPlayers) {
      const histId=evId+"_"+p._id;
      const entry={
        _id:histId,playerId:p._id,playerName:p.name,date:evDate,
        eventId:evId,eventTitle:selEv.title,
        statut:"present",equipes:Array.isArray(p.equipes)?p.equipes:[],
      };
      await fbSet('presencesHistory',histId,entry);
      newEntries.push(entry);
    }
    // Mise à jour locale immédiate
    setHistory(hs=>{
      const ids=newEntries.map(e=>e._id);
      const filtered=hs.filter(h=>!ids.includes(h._id));
      return [...filtered,...newEntries];
    });
  }

  function getStatut(p) {
    if(!selEv) return "present";
    const evId=selEv._id;
    const entry=history.find(h=>h.eventId===evId&&h.playerId===p._id);
    return entry?entry.statut:"present";
  }
  function statutColor(p) {
    const s=getStatut(p);
    return s==="present"?C.green:s==="retard"?C.orange:C.red;
  }

  const STATUTS_COACH=[
    {key:"present",label:"Présente", color:C.green, bg:"#0A2A1A",icon:"✓"},
    {key:"absent", label:"Absente",  color:C.red,   bg:"#2A0A0A",icon:"✗"},
    {key:"retard", label:"En retard",color:C.orange,bg:"#2A1A0A",icon:"⏱"},
  ];
  const STATUTS_PARENT=[
    {key:"absent", label:"Absente",  color:C.red,   bg:"#2A0A0A",icon:"✗"},
    {key:"retard", label:"En retard",color:C.orange,bg:"#2A1A0A",icon:"⏱"},
  ];
  function getStatuts() { return role==="parent"?STATUTS_PARENT:STATUTS_COACH; }

  function prevM() { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }
  function nextM() { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }

  const TYPE_ICONS={match:"⚔️",entrainement:"🏃",rdv:"📅",tournoi:"🏆"};

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
        <View>
          <GoldText style={{fontSize:28}}>Feuille d'appel</GoldText>
          <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
        </View>
        <TouchableOpacity onPress={loadHistory}
          style={{backgroundColor:C.card,borderRadius:20,paddingHorizontal:12,paddingVertical:7,flexDirection:"row",alignItems:"center",gap:6,borderWidth:1,borderColor:C.border}}>
          <Text style={{fontSize:14}}>🔄</Text>
          <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>Actualiser</Text>
        </TouchableOpacity>
      </View>
      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Navigation mensuelle */}
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:14,marginVertical:10}}>
          <TouchableOpacity onPress={prevM} style={{backgroundColor:C.card,borderRadius:10,width:36,height:36,alignItems:"center",justifyContent:"center"}}>
            <Text style={{color:C.gold,fontSize:18,fontWeight:"700"}}>‹</Text>
          </TouchableOpacity>
          <GoldText style={{fontSize:18}}>{MONTHS[month]} {year}</GoldText>
          <TouchableOpacity onPress={nextM} style={{backgroundColor:C.card,borderRadius:10,width:36,height:36,alignItems:"center",justifyContent:"center"}}>
            <Text style={{color:C.gold,fontSize:18,fontWeight:"700"}}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Liste des séances du mois */}
        <View style={{paddingHorizontal:14,marginBottom:10}}>
          {monthEvents.length===0?(
            <Card style={{alignItems:"center",padding:20}}>
              <Text style={{color:C.gray,fontSize:13}}>Aucune séance ce mois-ci pour {eq.label}</Text>
            </Card>
          ):monthEvents.map(ev=>{
            const tc=TYPE_CONFIG[ev.type]||TYPE_CONFIG.entrainement;
            const isSel=selEv?._id===ev._id;
            const isPast=ev.date<todayStr();
            return (
              <TouchableOpacity key={ev._id} onPress={()=>setSelEv(isSel?null:ev)}
                style={{flexDirection:"row",alignItems:"center",gap:12,padding:14,borderRadius:14,
                  backgroundColor:isSel?tc.color+"25":C.card,
                  borderWidth:2,borderColor:isSel?tc.color:C.border,marginBottom:8,
                  opacity:isPast&&!isSel?0.7:1}}>
                <View style={{width:46,height:46,borderRadius:12,backgroundColor:tc.color+"20",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:tc.color}}>
                  <Text style={{fontSize:20}}>{tc.icon}</Text>
                  <Text style={{color:tc.color,fontSize:9,fontWeight:"800"}}>{ev.date.split("-")[2]}/{ev.date.split("-")[1]}</Text>
                </View>
                <View style={{flex:1}}>
                  <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>{ev.title}</Text>
                  <Text style={{color:C.gray,fontSize:11,marginTop:2}}>{fmt(ev.date)} à {ev.heure}</Text>
                  {ev.lieu?<Text style={{color:C.gray,fontSize:11}}>📍 {ev.lieu}</Text>:null}
                </View>
                <View style={{alignItems:"center",gap:4}}>
                  <View style={{backgroundColor:isSel?tc.color:C.card2,borderRadius:20,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:tc.color}}>
                    <Text style={{color:isSel?C.white:tc.color,fontWeight:"700",fontSize:11}}>{isSel?"✓ Sélectionné":"Faire l'appel"}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Appel pour la séance sélectionnée */}
        {selEv&&(
          <>
            <View style={{paddingHorizontal:14,marginBottom:6}}>
              <Card style={{backgroundColor:TYPE_CONFIG[selEv.type]?.light||C.card2,borderWidth:1.5,borderColor:TYPE_CONFIG[selEv.type]?.color||C.border}}>
                <Text style={{color:C.gold,fontSize:11,fontWeight:"700",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Appel en cours</Text>
                <Text style={{color:C.white,fontWeight:"800",fontSize:16}}>{selEv.title}</Text>
                <Text style={{color:C.gray,fontSize:12}}>{fmt(selEv.date)} à {selEv.heure}</Text>
              </Card>
            </View>

            {/* Compteurs */}
            <View style={{flexDirection:"row",gap:10,paddingHorizontal:14,marginBottom:10}}>
              {[
                {label:"Présentes",val:pCount,  color:C.green},
                {label:"Absentes", val:aCount,  color:C.red},
                {label:"En retard",val:rCount,  color:C.orange},
              ].map(s=>(
                <Card key={s.label} style={{flex:1,alignItems:"center",padding:10}}>
                  <Text style={{fontSize:20,fontWeight:"900",color:s.color}}>{s.val}</Text>
                  <Text style={{fontSize:9,color:C.gray,fontWeight:"700",textTransform:"uppercase",textAlign:"center"}}>{s.label}</Text>
                </Card>
              ))}
            </View>

            <Card style={{marginHorizontal:14,marginBottom:10}}>
              <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <Text style={{color:C.white,fontWeight:"700"}}>
                  <Text style={{color:C.gold}}>{pCount}</Text>/{teamPlayers.length} présentes
                </Text>
                {canEdit&&<Btn small variant="gold" onPress={allPresent}>Toutes présentes</Btn>}
              </View>
              <View style={{backgroundColor:C.border,borderRadius:10,height:10,overflow:"hidden",flexDirection:"row"}}>
                <View style={{width:`${teamPlayers.length>0?(pCount/teamPlayers.length)*100:0}%`,height:"100%",backgroundColor:C.green}}/>
                <View style={{width:`${teamPlayers.length>0?(rCount/teamPlayers.length)*100:0}%`,height:"100%",backgroundColor:C.orange}}/>
                <View style={{width:`${teamPlayers.length>0?(aCount/teamPlayers.length)*100:0}%`,height:"100%",backgroundColor:C.red}}/>
              </View>
            </Card>

            <View style={{paddingHorizontal:14,marginBottom:100}}>
              {teamPlayers.map(p=>{
                const statut=getStatut(p);
                const sc=statutColor(p);
                const canEditThis=canEditPlayer(p);
                return (
                  <Card key={p._id} style={{marginBottom:8,borderLeftWidth:4,borderLeftColor:sc}}>
                    <View style={{flexDirection:"row",alignItems:"center",gap:12,marginBottom:canEditThis?10:0}}>
                      <Avatar initials={p.avatar||"??"} size={42}/>
                      <View style={{flex:1}}>
                        <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>{p.name}</Text>
                        <Text style={{color:C.gray,fontSize:12}}>#{p.num} · {p.poste}</Text>
                        {(p.parent1||p.parent2)&&<Text style={{color:C.gray,fontSize:11,marginTop:2}}>👪 {p.parent1||""}{p.parent2?" · "+p.parent2:""}</Text>}
                      </View>
                      <View style={{backgroundColor:sc+"25",borderRadius:20,paddingHorizontal:10,paddingVertical:4}}>
                        <Text style={{color:sc,fontWeight:"800",fontSize:12}}>
                          {statut==="present"?"✓ Présente":statut==="retard"?"⏱ Retard":"✗ Absente"}
                        </Text>
                      </View>
                    </View>
                    {canEditThis&&(
                      <View style={{flexDirection:"row",gap:8}}>
                        {getStatuts().map(s=>(
                          <TouchableOpacity key={s.key} onPress={()=>setStatut(p,s.key)}
                            style={{flex:1,paddingVertical:8,borderRadius:10,alignItems:"center",
                              backgroundColor:statut===s.key?s.bg:C.card2,
                              borderWidth:1.5,borderColor:statut===s.key?s.color:C.border}}>
                            <Text style={{color:statut===s.key?s.color:C.gray,fontWeight:"800",fontSize:11}}>{s.icon} {s.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </Card>
                );
              })}
            </View>
          </>
        )}

        {!selEv&&(
          <View style={{paddingHorizontal:14,marginBottom:100}}>
            <Card style={{alignItems:"center",padding:24}}>
              <Text style={{fontSize:36,marginBottom:10}}>☝️</Text>
              <Text style={{color:C.gray,fontSize:13,textAlign:"center"}}>Sélectionnez une séance ci-dessus pour faire l'appel</Text>
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
// ─── MESSAGERIE ──────────────────────────────────────────────────────────────
function Messagerie({ messages, setMessages, currentEquipe, onEquipeChange, user }) {
  const [newMsg, setNewMsg]=useState("");
  const [refreshing, setRefreshing]=useState(false);

  async function refreshMessages() {
    setRefreshing(true);
    const fresh=await fbGet('messages');
    setMessages(fresh);
    setRefreshing(false);
  }

  // Rafraîchissement auto toutes les 20 secondes
  useEffect(()=>{
    refreshMessages();
    const interval=setInterval(refreshMessages, 10000);
    return ()=>clearInterval(interval);
  },[currentEquipe]);
  const eq=EQUIPES.find(e=>e.id===currentEquipe);
  const msgList=messages.filter(m=>m.equipe===currentEquipe).sort((a,b)=>b._id.localeCompare(a._id));
  const canSend=can(user,"sendMessages");
  const role=getRole(user);

  async function send() {
    if(!newMsg.trim()||!canSend) return;
    const id=Date.now().toString();
    const label=role==="coach"?"👑 Coach":role==="adjoint"?"🎽 "+user.name:"👪 "+user.name;
    const data={auteur:label,texte:newMsg.trim(),date:todayFmt(),heure:timeStr(),equipe:currentEquipe};
    await fbSet('messages',id,data);
    setMessages(ms=>[...ms,{...data,_id:id}]);
    setNewMsg("");
  }
  async function del(m) {
    if(!user.isCoach) return;
    await fbDel('messages',m._id);
    setMessages(ms=>ms.filter(x=>x._id!==m._id));
  }

  function getMsgStyle(auteur) {
    if(auteur.includes("👑")) return {bg:C.primary+"20",border:C.primary+"40",nameColor:C.gold};
    if(auteur.includes("🎽")) return {bg:C.orange+"15",border:C.orange+"40",nameColor:C.orange};
    return {bg:C.card2,border:C.border,nameColor:C.primaryLight};
  }

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border}}>
        <GoldText style={{fontSize:28}}>Messagerie</GoldText>
        <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <ScrollView style={{flex:1,paddingHorizontal:14}} showsVerticalScrollIndicator={false}>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginVertical:10}}>
          <View style={{flexDirection:"row",alignItems:"center",gap:8}}>
            <View style={{width:8,height:8,borderRadius:4,backgroundColor:eq.color}}/>
            <GoldText style={{fontSize:14}}>Messages · {eq.label}</GoldText>
          </View>
          <TouchableOpacity onPress={refreshMessages}
            style={{backgroundColor:C.card,borderRadius:10,paddingHorizontal:12,paddingVertical:7,borderWidth:1,borderColor:C.border}}>
            <Text style={{fontSize:16}}>{refreshing?"⏳":"🔄"}</Text>
          </TouchableOpacity>
        </View>
        {msgList.length===0?(
          <Card style={{alignItems:"center",padding:30}}>
            <Text style={{fontSize:40,marginBottom:10}}>💬</Text>
            <Text style={{color:C.gray,fontSize:14,textAlign:"center"}}>Aucun message pour le moment.</Text>
          </Card>
        ):msgList.map(msg=>{
          const ms=getMsgStyle(msg.auteur);
          return (
            <View key={msg._id} style={{marginBottom:10}}>
              <View style={{backgroundColor:ms.bg,borderRadius:16,padding:14,borderWidth:1,borderColor:ms.border}}>
                <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <Text style={{color:ms.nameColor,fontWeight:"700",fontSize:13}}>{msg.auteur}</Text>
                  <View style={{flexDirection:"row",alignItems:"center",gap:8}}>
                    <Text style={{color:C.gray,fontSize:11}}>{msg.date} {msg.heure}</Text>
                    {user.isCoach&&<TouchableOpacity onPress={()=>del(msg)}><Text style={{color:C.red,fontSize:16}}>🗑️</Text></TouchableOpacity>}
                  </View>
                </View>
                <Text style={{color:C.white,fontSize:14,lineHeight:20}}>{msg.texte}</Text>
              </View>
            </View>
          );
        })}
        <View style={{height:100}}/>
      </ScrollView>
      {canSend&&(
        <View style={{padding:14,backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.border}}>
          <View style={{flexDirection:"row",gap:10,alignItems:"flex-end"}}>
            <TextInput value={newMsg} onChangeText={setNewMsg} placeholder={`Message à ${eq.label}…`} placeholderTextColor={C.gray} multiline
              style={{flex:1,backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:14,padding:12,color:C.white,fontSize:14,maxHeight:100}}/>
            <TouchableOpacity onPress={send} style={{width:44,height:44,borderRadius:22,backgroundColor:C.primary,alignItems:"center",justifyContent:"center"}}>
              <Text style={{fontSize:20}}>➤</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── SONDAGES ────────────────────────────────────────────────────────────────
function Sondages({ sondages, setSondages, currentEquipe, onEquipeChange, user }) {
  const [showForm, setShowForm]=useState(false);
  const [form, setForm]=useState({question:"",equipe:currentEquipe});
  const [refreshing, setRefreshing]=useState(false);

  // Rafraîchir les sondages depuis Firebase
  async function refreshSondages() {
    setRefreshing(true);
    const fresh=await fbGet('sondages');
    setSondages(fresh);
    setRefreshing(false);
  }

  // Rafraîchissement auto toutes les 30 secondes
  useEffect(()=>{
    refreshSondages();
    const interval=setInterval(refreshSondages, 10000);
    return ()=>clearInterval(interval);
  },[currentEquipe]);
  const [reponseTexte, setReponseTexte]=useState({});
  const [reponseNombre, setReponseNombre]=useState({});
  const eq=EQUIPES.find(e=>e.id===currentEquipe);
  const sondageList=sondages.filter(s=>s.equipe===currentEquipe);
  const canCreate=can(user,"manageSondages");
  const canRepondre=can(user,"repondreSondage");

  async function createSondage() {
    if(!form.question?.trim()) return;
    const id=Date.now().toString();
    const data={
      question:form.question,equipe:currentEquipe,date:todayFmt(),
      reponses:{},actif:"true",
      typeReponse:form.typeReponse||"ouinonpeutetre",
      options:form.options||""
    };
    await fbSet('sondages',id,data);
    setSondages(ss=>[...ss,{...data,_id:id}]);
    setShowForm(false);
    setForm({question:"",equipe:currentEquipe});
  }

  async function repondreOuiNon(sondage, reponse) {
    if(!canRepondre) return;
    const reponses=sondage.reponses||{};
    const existing=reponses[user.email];
    const newReponse=existing===reponse?"":reponse;
    const newReponses={...reponses,[user.email]:newReponse};
    if(!newReponse) delete newReponses[user.email];
    const updated={...sondage,reponses:newReponses};
    await fbSet('sondages',sondage._id,updated);
    setSondages(ss=>ss.map(s=>s._id===sondage._id?updated:s));
  }

  async function repondreTexteNombre(sondage, valeur) {
    if(!canRepondre||!valeur.trim()) return;
    const reponses=sondage.reponses||{};
    const newReponses={...reponses,[user.email]:valeur.trim()};
    const updated={...sondage,reponses:newReponses};
    await fbSet('sondages',sondage._id,updated);
    setSondages(ss=>ss.map(s=>s._id===sondage._id?updated:s));
    setReponseTexte(r=>({...r,[sondage._id]:""}));
    setReponseNombre(r=>({...r,[sondage._id]:""}));
  }

  async function repondreChoix(sondage, choix) {
    if(!canRepondre) return;
    const reponses=sondage.reponses||{};
    const existing=reponses[user.email]||"";
    // Toggle choix multiples
    const choixActuels=existing?existing.split(",").filter(Boolean):[];
    const newChoix=choixActuels.includes(choix)
      ?choixActuels.filter(c=>c!==choix)
      :[...choixActuels,choix];
    const newVal=newChoix.join(",");
    const newReponses={...reponses,[user.email]:newVal};
    const updated={...sondage,reponses:newReponses};
    await fbSet('sondages',sondage._id,updated);
    setSondages(ss=>ss.map(s=>s._id===sondage._id?updated:s));
  }

  async function delSondage(s) {
    if(!canCreate) return;
    await fbDel('sondages',s._id);
    setSondages(ss=>ss.filter(x=>x._id!==s._id));
  }

  function countReponses(sondage, type) {
    return Object.values(sondage.reponses||{}).filter(r=>r===type).length;
  }

  function renderReponses(s) {
    const type=s.typeReponse||"ouinonpeutetre";
    const myReponse=(s.reponses||{})[user.email]||"";
    const total=Object.keys(s.reponses||{}).length;

    // ── OUI / NON / PEUT-ÊTRE ─────────────────────────────────────────────
    if(type==="ouinonpeutetre") {
      const oui=countReponses(s,"oui");
      const non=countReponses(s,"non");
      const peutetre=countReponses(s,"peutetre");
      return (
        <>
          {total>0&&(
            <View style={{marginBottom:12}}>
              {[
                {label:"✅ Oui",val:oui,color:C.green},
                {label:"❌ Non",val:non,color:C.red},
                {label:"🤔 Peut-être",val:peutetre,color:C.gold},
              ].map(r=>(
                <View key={r.label} style={{flexDirection:"row",alignItems:"center",gap:8,marginBottom:6}}>
                  <Text style={{color:C.white,fontSize:12,width:100}}>{r.label}</Text>
                  <View style={{flex:1,backgroundColor:C.border,borderRadius:6,height:8,overflow:"hidden"}}>
                    <View style={{width:total>0?`${(r.val/total)*100}%`:"0%",height:"100%",backgroundColor:r.color,borderRadius:6}}/>
                  </View>
                  <Text style={{color:r.color,fontWeight:"700",fontSize:12,width:20,textAlign:"right"}}>{r.val}</Text>
                </View>
              ))}
            </View>
          )}
          {canRepondre&&(
            <View style={{flexDirection:"row",gap:8}}>
              {[
                {val:"oui",    label:"✅ Oui",      color:C.green},
                {val:"non",    label:"❌ Non",      color:C.red},
                {val:"peutetre",label:"🤔 Peut-être",color:C.gold},
              ].map(r=>(
                <TouchableOpacity key={r.val} onPress={()=>repondreOuiNon(s,r.val)}
                  style={{flex:1,paddingVertical:8,borderRadius:10,alignItems:"center",
                    backgroundColor:myReponse===r.val?r.color+"30":C.card2,
                    borderWidth:1.5,borderColor:myReponse===r.val?r.color:C.border}}>
                  <Text style={{color:myReponse===r.val?r.color:C.gray,fontWeight:"700",fontSize:11}}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      );
    }

    // ── TEXTE LIBRE ──────────────────────────────────────────────────────
    if(type==="texte") {
      const reponsesList=Object.entries(s.reponses||{});
      return (
        <>
          {reponsesList.length>0&&(
            <View style={{marginBottom:12}}>
              <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:6,textTransform:"uppercase"}}>{reponsesList.length} réponse{reponsesList.length>1?"s":""}</Text>
              {reponsesList.map(([email,val])=>(
                <View key={email} style={{padding:8,borderRadius:8,backgroundColor:C.card2,borderLeftWidth:3,borderLeftColor:C.primaryLight,marginBottom:6}}>
                  <Text style={{color:C.gray,fontSize:10,marginBottom:2}}>{email}</Text>
                  <Text style={{color:C.white,fontSize:13}}>{val}</Text>
                </View>
              ))}
            </View>
          )}
          {canRepondre&&(
            <View style={{flexDirection:"row",gap:8,alignItems:"flex-end"}}>
              <TextInput
                value={reponseTexte[s._id]||""}
                onChangeText={v=>setReponseTexte(r=>({...r,[s._id]:v}))}
                placeholder="Votre réponse…"
                placeholderTextColor={C.gray}
                multiline
                style={{flex:1,backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,color:C.white,fontSize:14,minHeight:60}}
              />
              <TouchableOpacity onPress={()=>repondreTexteNombre(s,reponseTexte[s._id]||"")}
                style={{backgroundColor:C.primary,borderRadius:10,padding:12,alignItems:"center",justifyContent:"center"}}>
                <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>Envoyer</Text>
              </TouchableOpacity>
            </View>
          )}
          {myReponse&&<Text style={{color:C.primaryLight,fontSize:12,marginTop:8}}>✓ Votre réponse : {myReponse}</Text>}
        </>
      );
    }

    // ── NOMBRE ───────────────────────────────────────────────────────────
    if(type==="nombre") {
      const reponsesList=Object.entries(s.reponses||{});
      const vals=reponsesList.map(([,v])=>Number(v)).filter(v=>!isNaN(v));
      const moy=vals.length>0?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1):"—";
      return (
        <>
          {reponsesList.length>0&&(
            <View style={{marginBottom:12,flexDirection:"row",gap:10}}>
              {[
                {label:"Réponses",val:reponsesList.length,color:C.gold},
                {label:"Moyenne", val:moy,               color:C.primaryLight},
                {label:"Min",     val:vals.length>0?Math.min(...vals):"—",color:C.green},
                {label:"Max",     val:vals.length>0?Math.max(...vals):"—",color:C.red},
              ].map(stat=>(
                <View key={stat.label} style={{flex:1,alignItems:"center",padding:8,backgroundColor:C.card2,borderRadius:10}}>
                  <Text style={{color:stat.color,fontWeight:"900",fontSize:16}}>{stat.val}</Text>
                  <Text style={{color:C.gray,fontSize:9,fontWeight:"700",textTransform:"uppercase"}}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )}
          {canRepondre&&(
            <View style={{flexDirection:"row",gap:8,alignItems:"center"}}>
              <TextInput
                value={reponseNombre[s._id]||""}
                onChangeText={v=>setReponseNombre(r=>({...r,[s._id]:v}))}
                placeholder="Entrez un nombre…"
                placeholderTextColor={C.gray}
                keyboardType="numeric"
                style={{flex:1,backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,color:C.white,fontSize:14}}
              />
              <TouchableOpacity onPress={()=>repondreTexteNombre(s,reponseNombre[s._id]||"")}
                style={{backgroundColor:C.primary,borderRadius:10,padding:12}}>
                <Text style={{color:C.white,fontWeight:"700"}}>OK</Text>
              </TouchableOpacity>
            </View>
          )}
          {myReponse&&<Text style={{color:C.primaryLight,fontSize:12,marginTop:8}}>✓ Votre réponse : {myReponse}</Text>}
        </>
      );
    }

    // ── CHOIX MULTIPLES ──────────────────────────────────────────────────
    if(type==="choix") {
      const options=(s.options||"").split(",").map(o=>o.trim()).filter(Boolean);
      const myChoix=myReponse?myReponse.split(",").filter(Boolean):[];
      // Compter les votes par option
      const allReponses=Object.values(s.reponses||{});
      const total=Object.keys(s.reponses||{}).length;
      return (
        <>
          <View style={{marginBottom:canRepondre?10:0}}>
            {options.map(opt=>{
              const votes=allReponses.filter(r=>r.split(",").includes(opt)).length;
              const isChosen=myChoix.includes(opt);
              return (
                <TouchableOpacity key={opt} onPress={()=>canRepondre?repondreChoix(s,opt):null}
                  style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,
                    backgroundColor:isChosen?C.primary+"30":C.card2,
                    borderWidth:1.5,borderColor:isChosen?C.primary:C.border,marginBottom:8}}>
                  <View style={{width:20,height:20,borderRadius:6,backgroundColor:isChosen?C.primary:C.border,alignItems:"center",justifyContent:"center"}}>
                    {isChosen&&<Text style={{color:C.white,fontWeight:"900",fontSize:12}}>✓</Text>}
                  </View>
                  <Text style={{color:isChosen?C.white:C.gray,fontWeight:"600",fontSize:14,flex:1}}>{opt}</Text>
                  {total>0&&(
                    <Text style={{color:C.primaryLight,fontWeight:"700",fontSize:12}}>{votes} vote{votes>1?"s":""}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {myReponse&&<Text style={{color:C.primaryLight,fontSize:12}}>✓ Sélectionné : {myReponse}</Text>}
        </>
      );
    }
    return null;
  }

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border}}>
        <GoldText style={{fontSize:28}}>Sondages</GoldText>
        <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <ScrollView style={{paddingHorizontal:14}} showsVerticalScrollIndicator={false}>
        <View style={{flexDirection:"row",gap:10,marginVertical:10}}>
          {canCreate&&(
            <Btn onPress={()=>setShowForm(true)} style={{flex:1}}>📊 Créer un sondage</Btn>
          )}
          <TouchableOpacity onPress={refreshSondages}
            style={{backgroundColor:C.card,borderRadius:10,paddingHorizontal:14,paddingVertical:11,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:C.border}}>
            <Text style={{fontSize:18}}>{refreshing?"⏳":"🔄"}</Text>
          </TouchableOpacity>
        </View>
        {sondageList.length===0?(
          <Card style={{alignItems:"center",padding:30,marginTop:10}}>
            <Text style={{fontSize:40,marginBottom:10}}>📊</Text>
            <Text style={{color:C.gray,fontSize:14,textAlign:"center"}}>Aucun sondage pour le moment.</Text>
          </Card>
        ):sondageList.map(s=>{
          const type=s.typeReponse||"ouinonpeutetre";
          const total=Object.keys(s.reponses||{}).length;
          const typeLabels={ouinonpeutetre:"👍 Oui/Non/Peut-être",texte:"✏️ Texte libre",nombre:"🔢 Nombre",choix:"☑️ Choix multiples"};
          return (
            <Card key={s._id}>
              <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <Text style={{color:C.white,fontWeight:"700",fontSize:15,flex:1,lineHeight:22}}>{s.question}</Text>
                {canCreate&&<TouchableOpacity onPress={()=>delSondage(s)} style={{padding:5}}><Text style={{color:C.red}}>🗑️</Text></TouchableOpacity>}
              </View>
              <View style={{flexDirection:"row",gap:8,marginBottom:12,alignItems:"center"}}>
                <View style={{backgroundColor:C.primary+"20",borderRadius:20,paddingHorizontal:8,paddingVertical:3}}>
                  <Text style={{color:C.primaryLight,fontSize:11,fontWeight:"700"}}>{typeLabels[type]||type}</Text>
                </View>
                <Text style={{color:C.gray,fontSize:11}}>📅 {s.date} · {eq.label} · {total} réponse{total>1?"s":""}</Text>
              </View>
              {renderReponses(s)}
            </Card>
          );
        })}
        <View style={{height:100}}/>
      </ScrollView>
      {canCreate&&(
        <ModalWrapper open={showForm} onClose={()=>setShowForm(false)} title="Nouveau sondage">
          <Input label="Question" value={form.question||""} onChangeText={v=>setForm(f=>({...f,question:v}))}
            placeholder="Ex: Disponible pour le tournoi du 21 juin ?" multiline style={{minHeight:80}}/>
          <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase"}}>Type de réponse</Text>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:14}}>
            {[
              {val:"ouinonpeutetre",label:"👍 Oui/Non/Peut-être"},
              {val:"texte",         label:"✏️ Texte libre"},
              {val:"nombre",        label:"🔢 Nombre"},
              {val:"choix",         label:"☑️ Choix multiples"},
            ].map(t=>(
              <TouchableOpacity key={t.val} onPress={()=>setForm(f=>({...f,typeReponse:t.val}))}
                style={{paddingHorizontal:12,paddingVertical:8,borderRadius:20,
                  backgroundColor:(form.typeReponse||"ouinonpeutetre")===t.val?C.primary:C.card2,
                  borderWidth:1,borderColor:(form.typeReponse||"ouinonpeutetre")===t.val?C.primaryLight:C.border}}>
                <Text style={{color:(form.typeReponse||"ouinonpeutetre")===t.val?C.white:C.gray,fontWeight:"700",fontSize:12}}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {form.typeReponse==="choix"&&(
            <Input label="Options (séparées par des virgules)" value={form.options||""}
              onChangeText={v=>setForm(f=>({...f,options:v}))}
              placeholder="Ex: Mardi 18h, Jeudi 20h, Samedi 10h"/>
          )}
          <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
            <Btn variant="secondary" onPress={()=>setShowForm(false)} style={{flex:1}}>Annuler</Btn>
            <Btn onPress={createSondage} style={{flex:1}}>Publier</Btn>
          </View>
        </ModalWrapper>
      )}
    </SafeAreaView>
  );
}
// ─── STATISTIQUES ────────────────────────────────────────────────────────────
function Statistiques({ players, events, currentEquipe, onEquipeChange }) {
  const eq=EQUIPES.find(e=>e.id===currentEquipe);
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe));
  const evList=events.filter(e=>e.equipe===currentEquipe);
  const totalMatchs=evList.filter(e=>e.type==="match").length;
  const totalEntrainements=evList.filter(e=>e.type==="entrainement").length;
  const totalTournois=evList.filter(e=>e.type==="tournoi").length;
  const [history, setHistory]=useState([]);
  const [loadingHistory, setLoadingHistory]=useState(true);

  useEffect(()=>{
    async function loadHistory() {
      setLoadingHistory(true);
      const h=await fbGet('presencesHistory');
      setHistory(h);
      setLoadingHistory(false);
    }
    loadHistory();
  },[currentEquipe]);

  function getPlayerStats(p) {
    const ph=history.filter(h=>h.playerId===p._id);
    const presences=ph.filter(h=>h.statut==="present").length;
    const absences=ph.filter(h=>h.statut==="absent").length;
    const retards=ph.filter(h=>h.statut==="retard").length;
    const total=presences+absences+retards;
    const taux=total>0?Math.round((presences/total)*100):null;
    return {presences,absences,retards,total,taux};
  }

  // Stats globales équipe
  const totalAppels=[...new Set(history.filter(h=>h.equipes&&h.equipes.includes(currentEquipe)).map(h=>h.date))].length;
  const presentCount=teamPlayers.filter(p=>p.present).length;
  const tauxJour=teamPlayers.length>0?Math.round((presentCount/teamPlayers.length)*100):0;

  // Tri par taux de présence
  const sortedPlayers=[...teamPlayers].sort((a,b)=>{
    const sa=getPlayerStats(a);
    const sb=getPlayerStats(b);
    return (sb.taux||0)-(sa.taux||0);
  });

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border}}>
        <GoldText style={{fontSize:28}}>Statistiques</GoldText>
        <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      <ScrollView style={{paddingHorizontal:14}} showsVerticalScrollIndicator={false}>

        {/* Compteurs saison */}
        <GoldText style={{fontSize:15,marginTop:10,marginBottom:10}}>Saison · {eq.label}</GoldText>
        <View style={{flexDirection:"row",gap:10,marginBottom:10}}>
          {[
            {label:"Matchs",      val:totalMatchs,        icon:"⚔️", color:C.red},
            {label:"Entraîn.",    val:totalEntrainements, icon:"🏃", color:C.blue},
            {label:"Tournois",    val:totalTournois,      icon:"🏆", color:C.primaryLight},
          ].map(s=>(
            <Card key={s.label} style={{flex:1,alignItems:"center",padding:12}}>
              <Text style={{fontSize:22}}>{s.icon}</Text>
              <Text style={{fontSize:26,fontWeight:"900",color:s.color}}>{s.val}</Text>
              <Text style={{fontSize:10,color:C.gray,fontWeight:"700",textTransform:"uppercase"}}>{s.label}</Text>
            </Card>
          ))}
        </View>

        {/* Présence du jour */}
        <Card style={{marginBottom:10}}>
          <GoldText style={{fontSize:14,marginBottom:10}}>📅 Présence du jour</GoldText>
          <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <Text style={{color:C.white,fontWeight:"700"}}>{presentCount}/{teamPlayers.length} présentes</Text>
            <Text style={{color:tauxJour>=75?C.green:tauxJour>=50?C.gold:C.red,fontWeight:"900",fontSize:20}}>{tauxJour}%</Text>
          </View>
          <View style={{backgroundColor:C.border,borderRadius:10,height:10,overflow:"hidden"}}>
            <View style={{width:`${tauxJour}%`,height:"100%",backgroundColor:tauxJour>=75?C.green:tauxJour>=50?C.gold:C.red,borderRadius:10}}/>
          </View>
        </Card>

        {/* Historique saison */}
        <Card style={{marginBottom:14}}>
          <GoldText style={{fontSize:14,marginBottom:4}}>📊 Appels enregistrés cette saison</GoldText>
          <Text style={{color:C.gray,fontSize:12,marginBottom:10}}>{totalAppels} séance{totalAppels>1?"s":""} enregistrée{totalAppels>1?"s":""}</Text>
          <View style={{flexDirection:"row",gap:10}}>
            {[
              {label:"Séances",  val:totalAppels,                                                                          color:C.gold},
              {label:"Joueuses", val:teamPlayers.length,                                                                   color:eq.color},
              {label:"Moy. présence", val:totalAppels>0?Math.round(history.filter(h=>h.statut==="present"&&h.equipes&&h.equipes.includes(currentEquipe)).length/Math.max(totalAppels,1))+"/"+teamPlayers.length:"—", color:C.green},
            ].map(s=>(
              <View key={s.label} style={{flex:1,alignItems:"center",padding:10,backgroundColor:C.card2,borderRadius:12,borderWidth:1,borderColor:C.border}}>
                <Text style={{fontSize:18,fontWeight:"900",color:s.color}}>{s.val}</Text>
                <Text style={{fontSize:9,color:C.gray,fontWeight:"700",textTransform:"uppercase",textAlign:"center",marginTop:2}}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Stats par joueuse */}
        <GoldText style={{fontSize:15,marginBottom:10}}>👤 Présences par joueuse (saison)</GoldText>
        {loadingHistory?(
          <ActivityIndicator color={C.gold} style={{marginTop:20}}/>
        ):sortedPlayers.map((p,idx)=>{
          const st=getPlayerStats(p);
          const taux=st.taux;
          const tauxColor=taux===null?C.gray:taux>=75?C.green:taux>=50?C.gold:C.red;
          return (
            <Card key={p._id} style={{marginBottom:8,padding:12}}>
              <View style={{flexDirection:"row",alignItems:"center",gap:10,marginBottom:st.total>0?10:0}}>
                <View style={{width:28,height:28,borderRadius:14,backgroundColor:C.card2,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:C.border}}>
                  <Text style={{color:C.gold,fontWeight:"800",fontSize:12}}>#{idx+1}</Text>
                </View>
                <Avatar initials={p.avatar||"??"} size={36}/>
                <View style={{flex:1}}>
                  <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>{p.name}</Text>
                  <Text style={{color:C.gray,fontSize:11}}>#{p.num} · {p.poste}</Text>
                </View>
                <View style={{alignItems:"flex-end"}}>
                  <Text style={{color:tauxColor,fontWeight:"900",fontSize:20}}>
                    {taux!==null?taux+"%":"—"}
                  </Text>
                  <Text style={{color:C.gray,fontSize:10}}>{st.presences}/{st.total} séances</Text>
                </View>
              </View>
              {st.total>0&&(
                <>
                  <View style={{backgroundColor:C.border,borderRadius:8,height:8,overflow:"hidden",flexDirection:"row",marginBottom:6}}>
                    <View style={{width:`${st.total>0?(st.presences/st.total)*100:0}%`,height:"100%",backgroundColor:C.green}}/>
                    <View style={{width:`${st.total>0?(st.retards/st.total)*100:0}%`,height:"100%",backgroundColor:C.orange}}/>
                    <View style={{width:`${st.total>0?(st.absences/st.total)*100:0}%`,height:"100%",backgroundColor:C.red}}/>
                  </View>
                  <View style={{flexDirection:"row",gap:8}}>
                    <Text style={{color:C.green,fontSize:11,fontWeight:"700"}}>✓ {st.presences} présences</Text>
                    <Text style={{color:C.orange,fontSize:11,fontWeight:"700"}}>⏱ {st.retards} retards</Text>
                    <Text style={{color:C.red,fontSize:11,fontWeight:"700"}}>✗ {st.absences} absences</Text>
                  </View>
                </>
              )}
              {st.total===0&&(
                <Text style={{color:C.gray,fontSize:11}}>Aucune séance enregistrée</Text>
              )}
            </Card>
          );
        })}
        <View style={{height:100}}/>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── GESTION ADJOINTS (coach principal uniquement) ────────────────────────────
function GestionAdjoints({ adjoints, setAdjoints }) {
  const [showModal, setShowModal]=useState(false);
  const [form, setForm]=useState({});
  const [editItem, setEditItem]=useState(null);

  const PERMS_LIST = [
    { key:"canEditCalendar",    label:"📅 Modifier l'agenda" },
    { key:"canManageSondages",  label:"📊 Gérer les sondages" },
    { key:"canManagePresences", label:"✅ Gérer les présences" },
    { key:"canManagePlayers",   label:"👥 Gérer les joueuses" },
    { key:"canSendMessages",    label:"💬 Envoyer des messages" },
  ];

  function openAdd() { setForm({email:"",nom:"",perms:{}}); setEditItem(null); setShowModal(true); }
  function openEdit(a) { setForm({...a,perms:{...a.perms}}); setEditItem(a); setShowModal(true); }

  async function save() {
    if(!form.email?.trim()) return Alert.alert("Erreur","L'email est obligatoire.");
    const id=editItem?editItem._id:Date.now().toString();
    const data={email:form.email.trim().toLowerCase(),nom:form.nom||"",perms:form.perms||{}};
    await fbSet('adjoints',id,data);
    if(editItem) setAdjoints(as=>as.map(a=>a._id===editItem._id?{...data,_id:id}:a));
    else setAdjoints(as=>[...as,{...data,_id:id}]);
    setShowModal(false);
  }

  async function del(a) {
    Alert.alert("Supprimer","Retirer ce coach adjoint ?",[{text:"Annuler",style:"cancel"},{text:"Supprimer",style:"destructive",onPress:async()=>{
      await fbDel('adjoints',a._id);
      setAdjoints(as=>as.filter(x=>x._id!==a._id));
    }}]);
  }

  function togglePerm(key) {
    setForm(f=>({...f,perms:{...f.perms,[key]:!f.perms?.[key]}}));
  }

  return (
    <Card style={{marginBottom:14}}>
      <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <GoldText style={{fontSize:15}}>🎽 Coachs Adjoints</GoldText>
        <Btn small onPress={openAdd}>+ Ajouter</Btn>
      </View>
      {adjoints.length===0?(
        <Text style={{color:C.gray,fontSize:13}}>Aucun coach adjoint pour le moment.</Text>
      ):adjoints.map(a=>(
        <View key={a._id} style={{padding:12,borderRadius:12,backgroundColor:C.card2,marginBottom:8,borderWidth:1,borderColor:C.orange+"40"}}>
          <View style={{flexDirection:"row",alignItems:"center",gap:10,marginBottom:8}}>
            <View style={{width:38,height:38,borderRadius:19,backgroundColor:C.orange+"30",alignItems:"center",justifyContent:"center",borderWidth:1.5,borderColor:C.orange}}>
              <Text style={{fontSize:18}}>🎽</Text>
            </View>
            <View style={{flex:1}}>
              <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>{a.nom||a.email}</Text>
              <Text style={{color:C.gray,fontSize:11}}>{a.email}</Text>
            </View>
            <TouchableOpacity onPress={()=>openEdit(a)} style={{padding:6,backgroundColor:C.card,borderRadius:8}}><Text>✏️</Text></TouchableOpacity>
            <TouchableOpacity onPress={()=>del(a)} style={{padding:6,backgroundColor:"#2A0A0A",borderRadius:8}}><Text>🗑️</Text></TouchableOpacity>
          </View>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
            {PERMS_LIST.filter(p=>a.perms?.[p.key]).map(p=>(
              <View key={p.key} style={{paddingHorizontal:8,paddingVertical:3,borderRadius:20,backgroundColor:C.orange+"20",borderWidth:1,borderColor:C.orange+"60"}}>
                <Text style={{color:C.orange,fontSize:10,fontWeight:"700"}}>{p.label}</Text>
              </View>
            ))}
            {PERMS_LIST.filter(p=>a.perms?.[p.key]).length===0&&(
              <Text style={{color:C.gray,fontSize:11}}>Aucune permission attribuée</Text>
            )}
          </View>
        </View>
      ))}

      <ModalWrapper open={showModal} onClose={()=>setShowModal(false)} title={editItem?"Modifier adjoint":"Nouveau coach adjoint"}>
        <Input label="Email du compte" value={form.email||""} onChangeText={v=>setForm(f=>({...f,email:v}))}
          placeholder="email@exemple.com" keyboardType="email-address" autoCapitalize="none"/>
        <Input label="Nom (affiché)" value={form.nom||""} onChangeText={v=>setForm(f=>({...f,nom:v}))}
          placeholder="Prénom Nom"/>
        <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:10,textTransform:"uppercase"}}>Permissions</Text>
        {PERMS_LIST.map(p=>{
          const active=!!form.perms?.[p.key];
          return (
            <TouchableOpacity key={p.key} onPress={()=>togglePerm(p.key)}
              style={{flexDirection:"row",alignItems:"center",gap:12,padding:12,borderRadius:12,backgroundColor:active?C.orange+"20":C.card2,borderWidth:1.5,borderColor:active?C.orange:C.border,marginBottom:8}}>
              <View style={{width:22,height:22,borderRadius:6,backgroundColor:active?C.orange:C.border,alignItems:"center",justifyContent:"center"}}>
                {active&&<Text style={{color:"#0D0D1A",fontWeight:"900",fontSize:13}}>✓</Text>}
              </View>
              <Text style={{color:active?C.white:C.gray,fontWeight:"600",fontSize:14,flex:1}}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{padding:12,borderRadius:10,backgroundColor:C.primary+"15",borderWidth:1,borderColor:C.primary,marginTop:8,marginBottom:16}}>
          <Text style={{color:C.gray,fontSize:12,lineHeight:18}}>
            💡 L'adjoint doit créer un compte avec cet email. Ses permissions seront actives à sa prochaine connexion.
          </Text>
        </View>
        <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
          <Btn variant="secondary" onPress={()=>setShowModal(false)} style={{flex:1}}>Annuler</Btn>
          <Btn onPress={save} style={{flex:1}}>Enregistrer</Btn>
        </View>
      </ModalWrapper>
    </Card>
  );
}


// ─── GESTION PARENTS ────────────────────────────────────────────────────────
function GestionParents({ parentsList, setParentsList }) {
  const [showModal, setShowModal]=useState(false);
  const [form, setForm]=useState({});
  const [editItem, setEditItem]=useState(null);
  const PERMS_PARENTS = [
    { key:"canInscriptionRole", label:"Inscription aux rôles (voiture, goûter…)" },
    { key:"canSendMessages",    label:"Envoyer des messages" },
    { key:"canCreateSondages",  label:"Créer des sondages" },
    { key:"canManagePresences", label:"Gérer les présences" },
    { key:"canVoirAnnuaire",    label:"Voir l'annuaire des parents" },
  ];
  function openAdd() { setForm({email:"",nom:"",perms:{canInscriptionRole:true}}); setEditItem(null); setShowModal(true); }
  function openEdit(p) { setForm({...p,perms:{...p.perms}}); setEditItem(p); setShowModal(true); }
  async function save() {
    if(!form.email?.trim()) return Alert.alert("Erreur","L'email est obligatoire.");
    const id=editItem?editItem._id:Date.now().toString();
    const data={email:form.email.trim().toLowerCase(),nom:form.nom||"",perms:form.perms||{canInscriptionRole:true}};
    await fbSet('parentsPerms',id,data);
    if(editItem) setParentsList(ps=>ps.map(p=>p._id===editItem._id?{...data,_id:id}:p));
    else setParentsList(ps=>[...ps,{...data,_id:id}]);
    setShowModal(false);
  }
  async function del(p) {
    Alert.alert("Supprimer","Retirer les permissions de ce parent ?",[{text:"Annuler",style:"cancel"},{text:"Supprimer",style:"destructive",onPress:async()=>{
      await fbDel('parentsPerms',p._id);
      setParentsList(ps=>ps.filter(x=>x._id!==p._id));
    }}]);
  }
  function togglePerm(key) { setForm(f=>({...f,perms:{...f.perms,[key]:!f.perms?.[key]}})); }
  return (
    <Card style={{marginBottom:14}}>
      <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <GoldText style={{fontSize:15}}>Permissions Parents</GoldText>
        <Btn small onPress={openAdd}>+ Ajouter</Btn>
      </View>
      <View style={{padding:10,borderRadius:10,backgroundColor:C.primary+"15",borderWidth:1,borderColor:C.primary,marginBottom:12}}>
        <Text style={{color:C.gray,fontSize:11,lineHeight:17}}>Par défaut les parents peuvent seulement consulter et répondre aux sondages. Ajoutez un parent ici pour lui donner des accès supplémentaires.</Text>
      </View>
      {parentsList.length===0?(
        <Text style={{color:C.gray,fontSize:13}}>Aucun parent avec permissions spéciales.</Text>
      ):parentsList.map(p=>(
        <View key={p._id} style={{padding:12,borderRadius:12,backgroundColor:C.card2,marginBottom:8,borderWidth:1,borderColor:C.blue+"40"}}>
          <View style={{flexDirection:"row",alignItems:"center",gap:10,marginBottom:8}}>
            <View style={{width:38,height:38,borderRadius:19,backgroundColor:C.blue+"30",alignItems:"center",justifyContent:"center",borderWidth:1.5,borderColor:C.blue}}>
              <Text style={{fontSize:18}}>👪</Text>
            </View>
            <View style={{flex:1}}>
              <Text style={{color:C.white,fontWeight:"700",fontSize:14}}>{p.nom||p.email}</Text>
              <Text style={{color:C.gray,fontSize:11}}>{p.email}</Text>
            </View>
            <TouchableOpacity onPress={()=>openEdit(p)} style={{padding:6,backgroundColor:C.card,borderRadius:8}}><Text>✏️</Text></TouchableOpacity>
            <TouchableOpacity onPress={()=>del(p)} style={{padding:6,backgroundColor:"#2A0A0A",borderRadius:8}}><Text>🗑️</Text></TouchableOpacity>
          </View>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
            {PERMS_PARENTS.filter(pl=>p.perms?.[pl.key]).map(pl=>(
              <View key={pl.key} style={{paddingHorizontal:8,paddingVertical:3,borderRadius:20,backgroundColor:C.blue+"20",borderWidth:1,borderColor:C.blue+"60"}}>
                <Text style={{color:C.blue,fontSize:10,fontWeight:"700"}}>{pl.label}</Text>
              </View>
            ))}
            {PERMS_PARENTS.filter(pl=>p.perms?.[pl.key]).length===0&&<Text style={{color:C.gray,fontSize:11}}>Lecture seule</Text>}
          </View>
        </View>
      ))}
      <ModalWrapper open={showModal} onClose={()=>setShowModal(false)} title={editItem?"Modifier":"Ajouter un parent"}>
        <Input label="Email du compte parent" value={form.email||""} onChangeText={v=>setForm(f=>({...f,email:v}))} placeholder="email@exemple.com" keyboardType="email-address" autoCapitalize="none"/>
        <Input label="Nom (affiché)" value={form.nom||""} onChangeText={v=>setForm(f=>({...f,nom:v}))} placeholder="Prénom Nom"/>
        <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:10,textTransform:"uppercase"}}>Permissions</Text>
        {PERMS_PARENTS.map(pl=>{
          const active=!!form.perms?.[pl.key];
          return (
            <TouchableOpacity key={pl.key} onPress={()=>togglePerm(pl.key)}
              style={{flexDirection:"row",alignItems:"center",gap:12,padding:12,borderRadius:12,backgroundColor:active?C.blue+"20":C.card2,borderWidth:1.5,borderColor:active?C.blue:C.border,marginBottom:8}}>
              <View style={{width:22,height:22,borderRadius:6,backgroundColor:active?C.blue:C.border,alignItems:"center",justifyContent:"center"}}>
                {active&&<Text style={{color:C.white,fontWeight:"900",fontSize:13}}>✓</Text>}
              </View>
              <Text style={{color:active?C.white:C.gray,fontWeight:"600",fontSize:14,flex:1}}>{pl.label}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{padding:12,borderRadius:10,backgroundColor:C.primary+"15",borderWidth:1,borderColor:C.primary,marginTop:8,marginBottom:16}}>
          <Text style={{color:C.gray,fontSize:12,lineHeight:18}}>Le parent doit avoir créé un compte avec cet email. Les permissions seront actives a sa prochaine connexion.</Text>
        </View>
        <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
          <Btn variant="secondary" onPress={()=>setShowModal(false)} style={{flex:1}}>Annuler</Btn>
          <Btn onPress={save} style={{flex:1}}>Enregistrer</Btn>
        </View>
      </ModalWrapper>
    </Card>
  );
}

// ─── AUTRES ──────────────────────────────────────────────────────────────────
function Autres({ lieux, setLieux, adversaires, setAdversaires, taches, setTaches, isCoach, user, onLogout, players, adjoints, setAdjoints, parentsList, setParentsList }) {
  const [section, setSection]=useState(null);
  const [form, setForm]=useState({});
  const [showModal, setShowModal]=useState(false);
  const [editItem, setEditItem]=useState(null);
  const role=getRole(user);

  async function resetHistorique() {
    Alert.alert(
      "Réinitialiser l'historique",
      "Cela supprimera toutes les entrées de présences enregistrées. Les stats repartiront de zéro. Continuer ?",
      [{text:"Annuler",style:"cancel"},{text:"Supprimer",style:"destructive",onPress:async()=>{
        fbGet('presencesHistory').then(all=>{
          Promise.all(all.map(entry=>fbDel('presencesHistory',entry._id)))
            .then(()=>Alert.alert("✅ Fait","L'historique a été réinitialisé."))
            .catch(()=>Alert.alert("Erreur","Impossible de réinitialiser."));
        });
      }}]
    );
  }

  function openAdd(type) { if(!isCoach) return; setForm({}); setEditItem(null); setSection(type); setShowModal(true); }
  function openEdit(item,type) { if(!isCoach) return; setForm({...item}); setEditItem(item); setSection(type); setShowModal(true); }

  async function save() {
    const id=editItem?editItem._id:Date.now().toString();
    if(section==="lieu") {
      if(!form.nom?.trim()) return;
      await fbSet('lieux',id,form);
      if(editItem) setLieux(ls=>ls.map(l=>l._id===editItem._id?{...form,_id:id}:l));
      else setLieux(ls=>[...ls,{...form,_id:id}]);
    }
    if(section==="adversaire") {
      if(!form.nom?.trim()) return;
      await fbSet('adversaires',id,form);
      if(editItem) setAdversaires(as=>as.map(a=>a._id===editItem._id?{...form,_id:id}:a));
      else setAdversaires(as=>[...as,{...form,_id:id}]);
    }
    if(section==="tache") {
      if(!form.texte?.trim()) return;
      await fbSet('taches',id,{...form,fait:form.fait||false});
      if(editItem) setTaches(ts=>ts.map(t=>t._id===editItem._id?{...form,_id:id}:t));
      else setTaches(ts=>[...ts,{...form,_id:id,fait:false}]);
    }
    setShowModal(false);
  }

  async function delItem(item,type) {
    await fbDel(type+'s',item._id);
    if(type==="lieu") setLieux(ls=>ls.filter(l=>l._id!==item._id));
    if(type==="adversaire") setAdversaires(as=>as.filter(a=>a._id!==item._id));
    if(type==="tache") setTaches(ts=>ts.filter(t=>t._id!==item._id));
  }

  async function toggleTache(t) {
    if(!isCoach) return;
    const updated={...t,fait:!t.fait};
    await fbSet('taches',t._id,updated);
    setTaches(ts=>ts.map(x=>x._id===t._id?updated:x));
  }

  return (
    <SafeAreaView style={{flex:1,backgroundColor:C.bg}}>
      <View style={{backgroundColor:C.card2,paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:1,borderBottomColor:C.border}}>
        <GoldText style={{fontSize:28}}>Autres</GoldText>
        <Text style={{color:C.gray,fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <ScrollView style={{padding:14}} showsVerticalScrollIndicator={false}>

        {/* PROFIL */}
        <Card style={{flexDirection:"row",alignItems:"center",gap:12,marginBottom:14}}>
          <View style={{width:50,height:50,borderRadius:25,backgroundColor:role==="coach"?C.gold:role==="adjoint"?C.orange:C.primary,alignItems:"center",justifyContent:"center"}}>
            <Text style={{fontSize:24}}>{role==="coach"?"👑":role==="adjoint"?"🎽":"👪"}</Text>
          </View>
          <View style={{flex:1}}>
            <Text style={{color:C.white,fontWeight:"700",fontSize:15}}>{user.name}</Text>
            <RoleBadge user={user}/>
            <Text style={{color:C.gray,fontSize:11}}>{user.email}</Text>
            {role==="adjoint"&&(
              <View style={{flexDirection:"row",flexWrap:"wrap",gap:4,marginTop:6}}>
                {user.adjointPerms?.canEditCalendar&&<View style={{backgroundColor:C.orange+"20",borderRadius:20,paddingHorizontal:7,paddingVertical:2}}><Text style={{color:C.orange,fontSize:9,fontWeight:"700"}}>📅 Agenda</Text></View>}
                {user.adjointPerms?.canManageSondages&&<View style={{backgroundColor:C.orange+"20",borderRadius:20,paddingHorizontal:7,paddingVertical:2}}><Text style={{color:C.orange,fontSize:9,fontWeight:"700"}}>📊 Sondages</Text></View>}
                {user.adjointPerms?.canManagePresences&&<View style={{backgroundColor:C.orange+"20",borderRadius:20,paddingHorizontal:7,paddingVertical:2}}><Text style={{color:C.orange,fontSize:9,fontWeight:"700"}}>✅ Appel</Text></View>}
                {user.adjointPerms?.canManagePlayers&&<View style={{backgroundColor:C.orange+"20",borderRadius:20,paddingHorizontal:7,paddingVertical:2}}><Text style={{color:C.orange,fontSize:9,fontWeight:"700"}}>👥 Joueuses</Text></View>}
                {user.adjointPerms?.canSendMessages&&<View style={{backgroundColor:C.orange+"20",borderRadius:20,paddingHorizontal:7,paddingVertical:2}}><Text style={{color:C.orange,fontSize:9,fontWeight:"700"}}>💬 Messages</Text></View>}
              </View>
            )}
          </View>
          <Btn small variant="danger" onPress={onLogout}>Déconnexion</Btn>
        </Card>

        {/* GESTION ADJOINTS (coach principal seulement) */}
        {isCoach&&<GestionAdjoints adjoints={adjoints} setAdjoints={setAdjoints}/>}

        {/* GESTION PERMISSIONS PARENTS */}
        {isCoach&&<GestionParents parentsList={parentsList} setParentsList={setParentsList}/>}

        {/* ANNUAIRE PARENTS */}
        {(isCoach||user.isAdjoint||can(user,'voirAnnuaire')||getRole(user)==='parent')&&<Card style={{marginBottom:14}}>
          <GoldText style={{fontSize:15,marginBottom:12}}>👪 Annuaire Parents</GoldText>
          {players.filter(p=>p.parent1||p.parent2).length===0?(
            <Text style={{color:C.gray,fontSize:13}}>Aucun parent enregistré.</Text>
          ):players.filter(p=>p.parent1||p.parent2).map(p=>(
            <View key={p._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:C.card2,marginBottom:6}}>
              <Avatar initials={p.avatar||"??"} size={36}/>
              <View style={{flex:1}}>
                <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>{p.name}</Text>
                {p.parent1&&<Text style={{color:C.gray,fontSize:11,marginTop:2}}>👤 {p.parent1}{p.emailParent1?" · "+p.emailParent1:""}</Text>}
                {p.parent2&&<Text style={{color:C.gray,fontSize:11}}>👤 {p.parent2}{p.emailParent2?" · "+p.emailParent2:""}</Text>}
              </View>
            </View>
          ))}
        </Card>}

        {/* RÉINITIALISER HISTORIQUE */}
        {isCoach&&(
          <Card style={{marginBottom:14,borderWidth:1.5,borderColor:C.red+"40"}}>
            <GoldText style={{fontSize:15,marginBottom:8}}>Historique des présences</GoldText>
            <Text style={{color:C.gray,fontSize:12,marginBottom:12,lineHeight:18}}>
              Si les statistiques affichent des séances en double, utilisez ce bouton pour repartir de zéro. Les données joueurs ne sont pas affectées.
            </Text>
            <TouchableOpacity onPress={resetHistorique}
              style={{backgroundColor:"#2A0A0A",borderRadius:10,padding:12,alignItems:"center",borderWidth:1.5,borderColor:C.red}}>
              <Text style={{color:C.red,fontWeight:"800",fontSize:14}}>Réinitialiser l'historique des stats</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* LIEUX, ADVERSAIRES, TÂCHES (coach seulement) */}
        {isCoach&&<>
          <Card style={{marginBottom:14}}>
            <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <GoldText style={{fontSize:15}}>📍 Lieux</GoldText>
              <Btn small onPress={()=>openAdd("lieu")}>+ Ajouter</Btn>
            </View>
            {lieux.map(l=>(
              <View key={l._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:C.card2,marginBottom:6}}>
                <Text style={{fontSize:18}}>📍</Text>
                <View style={{flex:1}}>
                  <Text style={{color:C.white,fontWeight:"700",fontSize:13}}>{l.nom}</Text>
                  {l.adresse&&<Text style={{color:C.gray,fontSize:11}}>{l.adresse}</Text>}
                </View>
                <TouchableOpacity onPress={()=>openEdit(l,"lieu")} style={{padding:5}}><Text>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>delItem(l,"lieu")} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
              </View>
            ))}
          </Card>
          <Card style={{marginBottom:14}}>
            <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <GoldText style={{fontSize:15}}>⚔️ Adversaires</GoldText>
              <Btn small onPress={()=>openAdd("adversaire")}>+ Ajouter</Btn>
            </View>
            {adversaires.map(a=>(
              <View key={a._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:C.card2,marginBottom:6}}>
                <Text style={{fontSize:18}}>⚔️</Text>
                <Text style={{color:C.white,fontWeight:"700",fontSize:13,flex:1}}>{a.nom}</Text>
                <TouchableOpacity onPress={()=>openEdit(a,"adversaire")} style={{padding:5}}><Text>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>delItem(a,"adversaire")} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
              </View>
            ))}
          </Card>
          <Card style={{marginBottom:14}}>
            <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <GoldText style={{fontSize:15}}>📋 Tâches</GoldText>
              <Btn small onPress={()=>openAdd("tache")}>+ Ajouter</Btn>
            </View>
            {taches.map(t=>(
              <TouchableOpacity key={t._id} onPress={()=>toggleTache(t)}
                style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:C.card2,marginBottom:6,borderLeftWidth:3,borderLeftColor:t.fait?C.green:C.border}}>
                <View style={{width:24,height:24,borderRadius:12,backgroundColor:t.fait?C.green:C.border,alignItems:"center",justifyContent:"center"}}>
                  {t.fait&&<Text style={{color:"#0D0D1A",fontWeight:"900",fontSize:13}}>✓</Text>}
                </View>
                <Text style={{color:t.fait?C.gray:C.white,flex:1,fontSize:13,textDecorationLine:t.fait?"line-through":"none"}}>{t.texte}</Text>
                <TouchableOpacity onPress={()=>delItem(t,"tache")} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
              </TouchableOpacity>
            ))}
          </Card>
        </>}

        <ModalWrapper open={showModal} onClose={()=>setShowModal(false)} title={section==="lieu"?"Lieu":section==="adversaire"?"Adversaire":"Tâche"}>
          {section==="lieu"&&<>
            <Input label="Nom du lieu" value={form.nom||""} onChangeText={v=>setForm(f=>({...f,nom:v}))} placeholder="Gymnase Paul Fort"/>
            <Input label="Adresse" value={form.adresse||""} onChangeText={v=>setForm(f=>({...f,adresse:v}))} placeholder="Lescar"/>
          </>}
          {section==="adversaire"&&<>
            <Input label="Nom de l'équipe" value={form.nom||""} onChangeText={v=>setForm(f=>({...f,nom:v}))} placeholder="Nom du club"/>
          </>}
          {section==="tache"&&<>
            <Input label="Description" value={form.texte||""} onChangeText={v=>setForm(f=>({...f,texte:v}))} placeholder="Tâche à effectuer" multiline style={{minHeight:80}}/>
          </>}
          <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
            <Btn variant="secondary" onPress={()=>setShowModal(false)} style={{flex:1}}>Annuler</Btn>
            <Btn onPress={save} style={{flex:1}}>Enregistrer</Btn>
          </View>
        </ModalWrapper>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── APP PRINCIPALE ──────────────────────────────────────────────────────────
const TABS = [
  { id:"dashboard",  label:"Accueil",  icon:"🏠" },
  { id:"players",    label:"Équipe",   icon:"👥" },
  { id:"calendar",   label:"Agenda",   icon:"📅" },
  { id:"presences",  label:"Appel",    icon:"✅" },
  { id:"messagerie", label:"Messages", icon:"💬" },
  { id:"sondages",   label:"Sondages", icon:"📊" },
  { id:"stats",      label:"Stats",    icon:"📈" },
  { id:"autres",     label:"Autres",   icon:"⚙️" },
];

export default function App() {
  const [user, setUser]=useState(null);
  const [tab, setTab]=useState("dashboard");
  const [currentEquipe, setCurrentEquipe]=useState("groupe");
  const [players, setPlayers]=useState([]);
  const [events, setEvents]=useState([]);
  const [messages, setMessages]=useState([]);
  const [sondages, setSondages]=useState([]);
  const [lieux, setLieux]=useState([]);
  const [adversaires, setAdversaires]=useState([]);
  const [taches, setTaches]=useState([]);
  const [adjoints, setAdjoints]=useState([]);
  const [infos, setInfos]=useState([]);
  const [parentsList, setParentsList]=useState([]);
  const [loading, setLoading]=useState(true);

  useEffect(()=>{
    async function checkAuth() {
      try {
        const saved=await AsyncStorage.getItem('lhb_user');
        if(saved) {
          const u=JSON.parse(saved);
          // Rafraîchir le token si > 55 minutes
          const age = Date.now() - (u.tokenTime || 0);
          if(age > 55 * 60 * 1000 && u.refreshToken) {
            const newToken = await refreshToken(u.refreshToken);
            if(newToken) {
              u.token = newToken;
              u.tokenTime = Date.now();
              await AsyncStorage.setItem('lhb_user', JSON.stringify(u));
            }
          }
          setUser(u);
          if(u.token) setFbToken(u.token);
        }
      } catch(e) {}
      setLoading(false);
    }
    checkAuth();
  },[]);

  // Recharge silencieuse de toutes les données (sans écran de chargement)
  async function reloadAll() {
    try {
      const [p,e,m,s,l,a,t,adj,inf,ppList]=await Promise.all([
        fbGet('players'),fbGet('events'),fbGet('messages'),fbGet('sondages'),
        fbGet('lieux'),fbGet('adversaires'),fbGet('taches'),fbGet('adjoints'),fbGet('infos'),fbGet('parentsPerms'),
      ]);
      setPlayers(p);setEvents(e);setMessages(m);setSondages(s);
      if(l.length>0)setLieux(l);
      if(a.length>0)setAdversaires(a);
      if(t.length>0)setTaches(t);
      setAdjoints(adj);setInfos(inf);setParentsList(ppList);
    } catch(err) {}
  }

  // Rafraîchissement automatique toutes les 30 secondes
  useEffect(()=>{
    if(!user) return;
    const interval=setInterval(reloadAll, 10000);
    return ()=>clearInterval(interval);
  },[user?.email]);

  useEffect(()=>{
    if(!user) return;
    // Rafraîchir le token si nécessaire avant de charger
    async function ensureFreshToken() {
      try {
        const saved = await AsyncStorage.getItem('lhb_user');
        if(saved) {
          const u = JSON.parse(saved);
          const age = Date.now() - (u.tokenTime || 0);
          if(age > 55 * 60 * 1000 && u.refreshToken) {
            const newToken = await refreshToken(u.refreshToken);
            if(newToken) {
              setFbToken(newToken);
              const updated = {...u, token:newToken, tokenTime:Date.now()};
              await AsyncStorage.setItem('lhb_user', JSON.stringify(updated));
            }
          } else if(u.token) {
            setFbToken(u.token);
          }
        }
      } catch(e) {}
    }
    async function load() {
      await ensureFreshToken();
      setLoading(true);
      try {
        const [p,e,m,s,l,a,t,adj,inf,ppList]=await Promise.all([
          fbGet('players'),fbGet('events'),fbGet('messages'),fbGet('sondages'),
          fbGet('lieux'),fbGet('adversaires'),fbGet('taches'),fbGet('adjoints'),fbGet('infos'),fbGet('parentsPerms'),
        ]);
        setPlayers(p);setEvents(e);setMessages(m);setSondages(s);
        setLieux(l.length>0?l:[{_id:"1",nom:"Gymnase Paul Fort",adresse:"Lescar"}]);
        setAdversaires(a.length>0?a:[{_id:"1",nom:"Zibero Sports Tardets"}]);
        setTaches(t.length>0?t:[{_id:"1",texte:"Préparer les maillots",fait:false}]);
        setAdjoints(adj);
        setInfos(inf);
        setParentsList(ppList);
        if(!user.isCoach&&!user.isAdjoint) {
          const ppDoc=ppList.find(x=>x.email===user.email);
          const newPerms=ppDoc?ppDoc.perms||{}:{};
          if(JSON.stringify(newPerms)!==JSON.stringify(user.parentPerms||{})) {
            const updated={...user,parentPerms:newPerms};
            setUser(updated);
            await AsyncStorage.setItem('lhb_user',JSON.stringify(updated));
          }
        }
        // Mettre à jour les perms de l'adjoint connecté si besoin
        if(user.isAdjoint) {
          const adjDoc=adj.find(x=>x.email===user.email);
          if(adjDoc&&JSON.stringify(adjDoc.perms)!==JSON.stringify(user.adjointPerms)) {
            const updated={...user,adjointPerms:adjDoc.perms||{}};
            setUser(updated);
            await AsyncStorage.setItem('lhb_user',JSON.stringify(updated));
          }
        }
      } catch(err) {}
      setLoading(false);
    }
    load();
  },[user?.email]);

  async function handleLogout() {
    await AsyncStorage.removeItem('lhb_user');
    setUser(null);
    setPlayers([]);setEvents([]);setMessages([]);setSondages([]);setAdjoints([]);setInfos([]);setParentsList([]);
  }

  if(loading&&!user) return (
    <View style={{flex:1,backgroundColor:C.bg,alignItems:"center",justifyContent:"center"}}>
      <Image source={require('./assets/LogoLHB.png')} style={{width:120,height:120,resizeMode:"contain",marginBottom:20}}/>
      <GoldText style={{fontSize:22,marginBottom:20}}>Lescar Handball</GoldText>
      <ActivityIndicator color={C.gold} size="large"/>
    </View>
  );

  if(!user) return <LoginScreen onLogin={setUser}/>;

  if(loading) return (
    <View style={{flex:1,backgroundColor:C.bg,alignItems:"center",justifyContent:"center"}}>
      <Image source={require('./assets/LogoLHB.png')} style={{width:100,height:100,resizeMode:"contain",marginBottom:16}}/>
      <ActivityIndicator color={C.gold} size="large"/>
      <Text style={{color:C.gray,marginTop:16,fontSize:14}}>Chargement…</Text>
    </View>
  );

  const isCoach=user.isCoach;

  return (
    <View style={{flex:1,backgroundColor:C.bg}}>
      <View style={{flex:1}}>
        {tab==="dashboard"  && <Dashboard players={players} events={events} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user} infos={infos} setInfos={setInfos} reloadAll={reloadAll}/>}
        {tab==="players"    && <Players players={players} setPlayers={setPlayers} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} loading={loading} user={user}/>}
        {tab==="calendar"   && <CalendarView events={events} setEvents={setEvents} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user} taches={taches}/>}
        {tab==="presences"  && <Presences players={players} setPlayers={setPlayers} events={events} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user}/>}
        {tab==="messagerie" && <Messagerie messages={messages} setMessages={setMessages} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user}/>}
        {tab==="sondages"   && <Sondages sondages={sondages} setSondages={setSondages} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user}/>}
        {tab==="stats"      && <Statistiques players={players} events={events} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe}/>}
        {tab==="autres"     && <Autres lieux={lieux} setLieux={setLieux} adversaires={adversaires} setAdversaires={setAdversaires} taches={taches} setTaches={setTaches} isCoach={isCoach} user={user} onLogout={handleLogout} players={players} adjoints={adjoints} setAdjoints={setAdjoints} parentsList={parentsList} setParentsList={setParentsList}/>}
      </View>
      <View style={{flexDirection:"row",backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.border,paddingBottom:20,paddingTop:8}}>
        {TABS.map(t=>(
          <TouchableOpacity key={t.id} onPress={()=>setTab(t.id)} style={{flex:1,alignItems:"center",justifyContent:"center"}}>
            <Text style={{fontSize:16,opacity:tab===t.id?1:0.45}}>{t.icon}</Text>
            <Text style={{fontSize:7,fontWeight:"800",textTransform:"uppercase",color:tab===t.id?C.gold:C.gray,marginTop:2}}>{t.label}</Text>
            {tab===t.id&&<View style={{width:14,height:2,borderRadius:1,backgroundColor:C.gold,marginTop:2}}/>}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}