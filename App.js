import React, { useState, useEffect } from "react";
import {
  View, Text, Image, ScrollView, TouchableOpacity, TextInput,
  Modal, FlatList, SafeAreaView, Alert, Linking, ActivityIndicator,
  KeyboardAvoidingView, Platform, StatusBar,
} from "react-native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
const FB_API_KEY = "AIzaSyCX6kZsPUvf2EEARZKEeTdZJS-fR3geHKE";
const FB_PROJECT = "lescarhandball-529c0";
const DB_URL = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const STORAGE_BUCKET = `${FB_PROJECT}.firebasestorage.app`;
const STORAGE_URL = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts`;
const COACH_EMAIL = "steffdelaseuva@gmail.com";

// ─── FETCH AVEC TIMEOUT ──────────────────────────────────────────────────────
// Évite le blocage infini sur Android (notamment Android 15 + Expo Go)
const FETCH_TIMEOUT = 10000; // 10 secondes
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('TIMEOUT');
    throw e;
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const r = await fetchWithTimeout(`${AUTH_URL}:signInWithPassword?key=${FB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d;
}
async function signUp(email, password) {
  const r = await fetchWithTimeout(`${AUTH_URL}:signUp?key=${FB_API_KEY}`, {
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
    const r = await fetchWithTimeout(`https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`, {
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

function parseDoc(doc) {
  try {
    const id = doc.name.split('/').pop();
    const fields = doc.fields || {};
    const obj = { _id: id };
    Object.keys(fields).forEach(k => {
      try {
        const v = fields[k];
        if (v.stringValue !== undefined) obj[k] = v.stringValue;
        else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
        else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
        else if (v.arrayValue !== undefined) obj[k] = (v.arrayValue.values || []).map(x => {
          if (x.mapValue !== undefined) {
            const map = {};
            Object.keys(x.mapValue.fields || {}).forEach(mk => {
              const mv = x.mapValue.fields[mk];
              map[mk] = mv.stringValue || mv.booleanValue || mv.integerValue || '';
            });
            return map;
          }
          return x.stringValue || x.integerValue || x.booleanValue || '';
        });
        else if (v.mapValue !== undefined) {
          const map = {};
          Object.keys(v.mapValue.fields || {}).forEach(mk => {
            const mv = v.mapValue.fields[mk];
            map[mk] = mv.stringValue || mv.booleanValue || mv.integerValue || '';
          });
          obj[k] = map;
        }
      } catch(fieldErr) {}
    });
    return obj;
  } catch(docErr) { return null; }
}

async function fbGet(collection) {
  try {
    let allDocs = [];
    let pageToken = null;
    // Pagination pour charger TOUS les documents (Firestore limite à 300 par page)
    do {
      const url = `${DB_URL}/${collection}?key=${FB_API_KEY}&pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
      const r = await fetchWithTimeout(url, { headers: authHeaders() });
      const d = await r.json();
      if (d.error) { console.warn('fbGet error', collection, d.error.code); return null; }
      if (d.documents) allDocs = allDocs.concat(d.documents.map(parseDoc).filter(Boolean));
      pageToken = d.nextPageToken || null;
    } while (pageToken);
    return allDocs;
  } catch(e) { return null; }
}

function isValidEvent(e) {
  return e && typeof e === 'object' && e._id && e.date && e.title;
}
function toFields(obj) {
  const fields = {};
  Object.keys(obj).forEach(k => {
    if (k === '_id') return;
    const v = obj[k];
    if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (Array.isArray(v)) {
      fields[k] = { arrayValue: { values: v.map(x => {
        if (typeof x === 'object' && x !== null) {
          // Objet dans tableau (ex: {nom, places}) → mapValue
          const mapFields = {};
          Object.keys(x).forEach(mk => { mapFields[mk] = { stringValue: String(x[mk] || '') }; });
          return { mapValue: { fields: mapFields } };
        }
        return { stringValue: String(x) };
      }) } };
    }
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
    const r = await fetchWithTimeout(`${DB_URL}/${collection}/${id}?key=${FB_API_KEY}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ fields: toFields(data) }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (d && d.error) return false;
    return true;
  } catch(e) { return false; }
}
async function fbDel(collection, id) {
  try { await fetchWithTimeout(`${DB_URL}/${collection}/${id}?key=${FB_API_KEY}`, { method: 'DELETE', headers: authHeaders() }); } catch(e) {}
}

// Ouvre la navigation GPS vers une adresse
function openNavigation(nomLieu) {
  const lieuData = LIEUX_FIXES.find(l => l.nom === nomLieu);
  const adresse = lieuData ? lieuData.adresse : nomLieu;
  const query = encodeURIComponent(adresse || nomLieu);
  // Essaie Waze en premier, sinon Google Maps
  Linking.openURL(`waze://?q=${query}&navigate=yes`).catch(()=>
    Linking.openURL(`https://maps.google.com/?q=${query}`)
  );
}

// Upload image vers Firebase Storage, retourne l'URL publique ou null
async function uploadImage(uri, folder) {
  return uploadFile(uri, folder, 'image/jpeg', '.jpg');
}

// Upload générique (image ou PDF) vers Firebase Storage, retourne l'URL publique ou null
async function uploadFile(uri, folder, mimeType, ext) {
  try {
    const filename = folder + '/' + Date.now() + ext;
    const encodedName = encodeURIComponent(filename);
    const response = await fetch(uri);
    const blob = await response.blob();
    const headers = authHeaders();
    headers['Content-Type'] = mimeType;
    const r = await fetch(`${STORAGE_URL}/${encodedName}?uploadType=media&key=${FB_API_KEY}`, {
      method: 'POST', headers, body: blob,
    });
    const d = await r.json();
    if (d.error) return null;
    return `${STORAGE_URL}/${encodedName}?alt=media&key=${FB_API_KEY}`;
  } catch(e) { return null; }
}

// Détecte si une URL est un PDF
function isPdfUrl(url) {
  if (!url) return false;
  return url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('%2fpdf') || url.toLowerCase().includes('application%2fpdf');
}

// Composant bouton de téléchargement / ouverture de fichier joint
function AttachmentButton({ url, label, color }) {
  if (!url) return null;
  const isPdf = isPdfUrl(url);
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      style={{flexDirection:"row",alignItems:"center",gap:8,backgroundColor:color||C.primary+"20",
        borderRadius:10,padding:10,borderWidth:1,borderColor:color||C.primary,marginTop:8}}>
      <Text style={{fontSize:18}}>{isPdf ? "📄" : "🖼️"}</Text>
      <Text style={{flex:1,color:color||C.primaryLight,fontWeight:"700",fontSize:13}} numberOfLines={1}>
        {label || (isPdf ? "Ouvrir le PDF" : "Voir la photo")}
      </Text>
      <Text style={{color:color||C.primaryLight,fontSize:12,fontWeight:"800"}}>📥</Text>
    </TouchableOpacity>
  );
}

// ─── THÈME ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#F5F0FF", card:"rgba(255,255,255,0.92)", card2:"rgba(237,233,254,0.85)",
  primary:"#6C3FC5", primaryLight:"#8B5CF6",
  gold:"#C9A227", white:"#FFFFFF", gray:"#6B7280",
  border:"#DDD6FE", input:"#EDE9FE",
  green:"#059669", red:"#DC2626", blue:"#3B82F6",
  orange:"#EA580C",
  text:"#1F2937", textLight:"#4B5563",
};
const SHADOW = { shadowColor:"#6C3FC5", shadowOffset:{width:0,height:2}, shadowOpacity:0.12, shadowRadius:6, elevation:4 };
const POSTES = ["Gardien","Arrière G","Arrière D","Demi-centre","Ailier G","Ailier D","Pivot"];
const TYPE_CONFIG = {
  match:        { color:"#DC2626", light:"#FEF2F2", icon:"⚔️",  label:"Match" },
  entrainement: { color:"#2563EB", light:"#EFF6FF", icon:"🏃",  label:"Entraînement" },
  rdv:          { color:"#C9A227", light:"#FFFBEB", icon:"📅",  label:"Réunion" },
  tournoi:      { color:"#7C3AED", light:"#F5F3FF", icon:"🏆",  label:"Tournoi" },
};
const EQUIPES = [
  { id:"groupe",  label:"Groupe -15F", color:"#1F2937", subtitle:"24 joueuses", logo:require('./assets/LogoLHB.png'), colorBg:"#6B7280" },
  { id:"equipe1", label:"Équipe 1",    color:"#C9A227", subtitle:"-15F",        logo:require('./assets/Horacek.jpg') },
  { id:"equipe2", label:"Équipe 2",    color:"#6C3FC5", subtitle:"-15F",        logo:require('./assets/Sako.jpg') },
];
const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_SHORT = ["L","M","M","J","V","S","D"];
const LIEN_E1 = 'https://www.ffhandball.fr/competitions/saison-2025-2026-21/departemental/championnat-13-ans-feminins-28826/poule-180763/journee-7/';
const LIEN_E2 = 'https://www.ffhandball.fr/competitions/saison-2025-2026-21/departemental/championnat-13-ans-feminins-28826/poule-180772/';
const ROLES_LIST_DEFAULT = ["🚗 Co-voiturage (je conduis)","🚗 Co-voiturage (je dépose ma fille)","📋 Table de marque","🍰 Goûter","👕 Maillots","🥤 Buvette"];

// Adversaires et lieux figés — ne consomment pas de lectures Firebase
const ADVERSAIRES_FIXES = [
  {_id:"f1",  nom:"Zibero Sports Tardets"},
  {_id:"f2",  nom:"HBC Gan"},
  {_id:"f3",  nom:"Ossau Handball Club"},
  {_id:"f4",  nom:"Asson Sports"},
  {_id:"f5",  nom:"Sukil Hand Cambo"},
  {_id:"f6",  nom:"St Pé Union Club"},
  {_id:"f7",  nom:"Pau Nousty Sport Handball"},
  {_id:"f8",  nom:"Buros Handball"},
  {_id:"f9",  nom:"Anglet Biarritz Olympique Handball"},
  {_id:"f10", nom:"Irisartarrak Handball"},
  {_id:"f11", nom:"Aviron Bayonnais Handball"},
  {_id:"f12", nom:"US St Palais Handball"},
  {_id:"f13", nom:"HBC Oloron"},
  {_id:"f14", nom:"HBC Lourdais"},
  {_id:"f15", nom:"Pays des Nestes HB"},
  {_id:"f16", nom:"Tournay HB"},
  {_id:"f17", nom:"US Rabastens de Bigorre"},
  {_id:"f18", nom:"Esprit Lons HB"},
  {_id:"f19", nom:"Bordes Sports"},
  {_id:"f20", nom:"HBC Escoubès"},
  {_id:"f21", nom:"US Nafarroa Handball"},
  {_id:"f22", nom:"Lasseube Handball"},
  {_id:"f23", nom:"AS Urrunarrak"},
  {_id:"f24", nom:"SICS Boucau Tarnos"},
  {_id:"f25", nom:"Entente Lee Ousse"},
  {_id:"f26", nom:"HBC Lucq de Béarn"},
  {_id:"f27", nom:"Stade Hendayais Handball"},
  {_id:"f28", nom:"Entente Barzunaise"},
  {_id:"f29", nom:"Orthez Handball"},
  {_id:"f30", nom:"Lescar Handball"},
];
const LIEUX_FIXES = [
  {_id:"l1",  nom:"Gymnase Paul Fort",           adresse:"Rue Colbert, Lescar"},
  {_id:"l2",  nom:"Gymnase Victor Hugo",          adresse:"Lescar"},
  {_id:"l3",  nom:"Salle René Nativité",          adresse:"44 Rue du Stade 64510 Bordes"},
  {_id:"l4",  nom:"Salle Jean Labarrere",         adresse:"8 Rue Las Grabes 64800 Asson"},
  {_id:"l5",  nom:"Salle Michel Labeguerie",      adresse:"Avenue d'Espagne 64250 Cambo les Bains"},
  {_id:"l6",  nom:"Salle Municipale Bourg",       adresse:"64470 Tardets Sorholus"},
  {_id:"l7",  nom:"Salle des Sports",             adresse:"Place de l'Europe 64260 Sevignacq Meyracq"},
  {_id:"l8",  nom:"Salle Municipale des Sports",  adresse:"Rue du Bearn 64420 Nousty"},
  {_id:"l9",  nom:"Salle Polyvalente Buros",      adresse:"Place de l'Eglise 64160 Buros"},
  {_id:"l10", nom:"Salle François Abadie",        adresse:"27 Chemin de Lannedarre 65100 Lourdes"},
  {_id:"l11", nom:"Centre Sportif et Culturel",   adresse:"12 Rue de Corisandre 64290 Gan"},
  {_id:"l12", nom:"Gymnase Municipal Lannemezan", adresse:"369 Route du 4 Septembre 65300 Lannemezan"},
  {_id:"l13", nom:"Gymnase Escoubes",             adresse:"Place de la Mairie 64160 Escoubes"},
  {_id:"l14", nom:"Salle Saint-Jean",             adresse:"9 Av de Brindos 64600 Anglet"},
  {_id:"l15", nom:"Salle Lauga",                  adresse:"Avenue Paul Pras 64100 Bayonne"},
  {_id:"l16", nom:"Salle Omnisports Amikuze",     adresse:"32 Rue de la Bidouze 64120 St Palais"},
  {_id:"l17", nom:"Salle Jai Alai",               adresse:"Avenue du Jai Alai 64220 St Jean Pied de Port"},
  {_id:"l18", nom:"Salle Gantxiki",               adresse:"Rue Olahaso, Trinquet 64310 St Pee sur Nivelle"},
  {_id:"l19", nom:"Salle Airoski",                adresse:"Quartier Gendarmerie 64780 Irissarry"},
  {_id:"l20", nom:"Salle Polyvalente Lasseube",   adresse:"Rue des Lavandières 64290 Lasseube"},
  {_id:"l21", nom:"Complexe Omnisport Palas",     adresse:"Avenue de Lattre de Tassigny 64400 Oloron Ste Marie"},
  {_id:"l22", nom:"Salle Iturbidea",              adresse:"Chemin Aguerrenborda 64122 Urrugne"},
  {_id:"l23", nom:"Salle Leo Lagrange",           adresse:"13 Allée du Collège 40220 Tarnos"},
  {_id:"l24", nom:"Espace Pierre Domenge",        adresse:"Allée de l'Eglise 64320 Lee"},
  {_id:"l25", nom:"Salle Polyvalente Lucq",       adresse:"Bourg 64360 Lucq de Bearn"},
  {_id:"l26", nom:"Salle Irandatz Haut",          adresse:"15 Rue Bigarena 64700 Hendaye"},
  {_id:"l27", nom:"Gymnase Municipal Barzun",     adresse:"Rue du Corps Franc Pommies 64530 Barzun"},
  {_id:"l28", nom:"Salle Polyvalente Tournay",    adresse:"Tournay 65190 Tournay"},
  {_id:"l29", nom:"Salle Polyvalente Rabastens",  adresse:"Rue des Burdalats 65140 Rabastens de Bigorre"},
  {_id:"l30", nom:"Salle Henri Prat",             adresse:"1594 Avenue François Mitterrand 64300 Orthez"},
  {_id:"l31", nom:"Complexe Sportif Lons",        adresse:"1 Mail de Coubertin 64140 Lons"},
];

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
    voirAnnuaire:     !!pp.canVoirAnnuaire,
  };
  return !!parentMap[action];
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function fmt(d) { if(!d) return ""; const [y,m,day]=d.split("-"); return `${day}/${m}/${y}`; }
function fmtJour(d) {
  if(!d) return "";
  const jours=["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const [y,m,day]=d.split("-");
  const date=new Date(parseInt(y),parseInt(m)-1,parseInt(day));
  return `${jours[date.getDay()]} ${day}/${m}/${y}`;
}
function getDays(y,m) { return new Date(y,m+1,0).getDate(); }
function getFirst(y,m) { let d=new Date(y,m,1).getDay(); return d===0?6:d-1; }
const ACOLORS = ["#6C3FC5","#3B82F6","#10B981","#FFD700","#EF4444","#EC4899","#F97316","#8B5CF6"];
function aColor(s) { let h=0; for(let c of s) h+=c.charCodeAt(0); return ACOLORS[h%ACOLORS.length]; }
function todayFmt() { const t=new Date(); return `${String(t.getDate()).padStart(2,"0")}/${String(t.getMonth()+1).padStart(2,"0")}/${t.getFullYear()}`; }
function timeStr() { const t=new Date(); return `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`; }
function todayStr() { const t=new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; }
// Retourne true si l'événement est terminé (date+heureFin dans le passé)
function isEventOver(ev) {
  if (!ev || !ev.date) return false;
  const heureFin = ev.heureFin || '';
  if (!heureFin) {
    // Pas d'heure de fin : on se base sur la date seule (terminé si date < aujourd'hui)
    return ev.date < todayStr();
  }
  const [h, m] = heureFin.split(':').map(Number);
  const evEnd = new Date(ev.date);
  evEnd.setHours(h || 0, m || 0, 0, 0);
  return new Date() > evEnd;
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function Avatar({ initials, size=42 }) {
  return (
    <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:aColor(initials),alignItems:"center",justifyContent:"center",borderWidth:1.5,borderColor:C.gold}}>
      <Text style={{color:C.text,fontWeight:"800",fontSize:size*0.36}}>{initials}</Text>
    </View>
  );
}
function GoldText({ children, style }) { return <Text style={[{color:C.gold,fontWeight:"800"},style]}>{children}</Text>; }
function Card({ children, style }) { return <View style={[{backgroundColor:C.card,borderRadius:16,padding:14,borderWidth:1.5,borderColor:C.border,marginBottom:10,...SHADOW},style]}>{children}</View>; }
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
      <TextInput style={[{backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,fontSize:14,color:C.text},style]} placeholderTextColor={C.gray} {...props}/>
    </View>
  );
}
function ModalWrapper({ open, onClose, title, children }) {
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}>
          <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:18,borderBottomWidth:1,borderBottomColor:C.border}}>
            <GoldText style={{fontSize:18}}>{title}</GoldText>
            <TouchableOpacity onPress={onClose} style={{padding:10,marginRight:-6}}>
              <View style={{width:32,height:32,borderRadius:16,backgroundColor:C.card2,alignItems:"center",justifyContent:"center"}}>
                <Text style={{color:C.gray,fontSize:18,fontWeight:"700"}}>✕</Text>
              </View>
            </TouchableOpacity>
          </View>
          <ScrollView style={{padding:18}}>{children}</ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
function EquipeSelector({ currentEquipe, onSelect, compact=false }) {
  if(compact) return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{paddingHorizontal:14,paddingVertical:4}}>
      {EQUIPES.map(eq=>{
        const isSel=currentEquipe===eq.id;
        return (
          <TouchableOpacity key={eq.id} onPress={()=>onSelect(eq.id)}
            style={{marginRight:8,paddingHorizontal:14,paddingVertical:7,borderRadius:20,
              backgroundColor:isSel?eq.color+"30":C.card,
              borderWidth:1.5,borderColor:isSel?eq.color:C.border,
              flexDirection:"row",alignItems:"center",gap:6}}>
            <Image source={eq.logo} style={{width:20,height:20,borderRadius:10,resizeMode:"cover"}}/>
            <Text style={{color:isSel?eq.color:C.text,fontWeight:"800",fontSize:13}}>{eq.label}</Text>
            {isSel&&<View style={{width:6,height:6,borderRadius:3,backgroundColor:eq.color}}/>}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:14,paddingTop:4,paddingBottom:4,minWidth:"100%",justifyContent:"center"}} style={{}}>
      {EQUIPES.map(eq=>{
        const isSel=currentEquipe===eq.id;
        return (
          <TouchableOpacity key={eq.id} onPress={()=>onSelect(eq.id)}
            style={{marginRight:8,width:100,height:100,borderRadius:14,backgroundColor:isSel?(eq.colorBg||eq.color)+"30":C.card,borderWidth:2,borderColor:isSel?eq.color:C.border,alignItems:"center",justifyContent:"center",overflow:"hidden",padding:4}}>
            <Image source={eq.logo} style={{width:52,height:52,borderRadius:26,resizeMode:"cover"}}/>
            <Text style={{color:isSel?eq.color:C.text,fontWeight:"800",fontSize:11,marginTop:3,textAlign:"center"}}>{eq.label}</Text>
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
      const msg=e.message.includes('TIMEOUT')?"Connexion trop lente. Vérifiez votre réseau et réessayez.":
                e.message.includes('EMAIL_NOT_FOUND')?"Email introuvable.":
                e.message.includes('WRONG_PASSWORD')?"Mot de passe incorrect.":
                e.message.includes('INVALID_PASSWORD')?"Mot de passe incorrect.":
                e.message.includes('INVALID_LOGIN_CREDENTIALS')?"Email ou mot de passe incorrect.":
                e.message.includes('EMAIL_EXISTS')?"Email déjà utilisé.":
                e.message.includes('WEAK_PASSWORD')?"Mot de passe trop faible (6 min).":
                e.message.includes('NetworkError')||e.message.includes('network')?"Pas de connexion réseau. Vérifiez votre WiFi ou 4G.":
                "Erreur de connexion. Vérifiez votre réseau.";
      setError(msg);
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
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
  // Charger les infos au montage si vides
  useEffect(()=>{
    if(infos.length===0) {
      fbGet('infos').then(data=>{ if(data.length>0) setInfos(data); });
    }
  },[]);
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];
  const today=new Date();
  // Fin de la semaine en cours (dimanche soir)
  const finSemaine=new Date(today);
  const joursAvantDimanche=(7-today.getDay())%7; // 0=dimanche
  finSemaine.setDate(today.getDate()+joursAvantDimanche);
  finSemaine.setHours(23,59,59,999);
  const todayStart=new Date(today); todayStart.setHours(0,0,0,0);
  const evList=events.filter(e=>isValidEvent(e)&&e.equipe===currentEquipe);
  const upcoming=evList.filter(e=>{
    const d=new Date(e.date);
    return d>=todayStart && d<=finSemaine;
  }).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const nextMatch=evList.filter(e=>e.type==="match"&&new Date(e.date)>=today).sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe)).sort((a,b)=>(a.order??999)-(b.order??999));
  const presentCount=0; // Voir l'onglet APPEL pour les présences du jour
  const role=getRole(user);
  const canManageInfos=role==="coach"||(role==="adjoint"); // coach + tous adjoints peuvent gérer les infos
  const [showInfoModal, setShowInfoModal]=useState(false);
  const [editInfo, setEditInfo]=useState(null);
  const [infoForm, setInfoForm]=useState({texte:"",auteur:""});
  const [infoImage, setInfoImage]=useState(null); // URI locale de l'image sélectionnée
  const [infoPdf, setInfoPdf]=useState(null);     // URI locale du PDF sélectionné
  const [infoPdfName, setInfoPdfName]=useState(""); // Nom du PDF
  const [uploadingInfo, setUploadingInfo]=useState(false);

  function openAddInfo() { setInfoForm({texte:"",auteur:user.name,adresse:""}); setInfoImage(null); setInfoPdf(null); setInfoPdfName(""); setEditInfo(null); setShowInfoModal(true); }
  function openEditInfo(info) { setInfoForm({texte:info.texte,auteur:info.auteur,adresse:info.adresse||""}); setInfoImage(null); setInfoPdf(null); setInfoPdfName(""); setEditInfo(info); setShowInfoModal(true); }

  async function pickInfoImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission refusée","Autorisez l'accès à la galerie dans les réglages."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets[0]) {
      setInfoImage(result.assets[0].uri);
      setInfoPdf(null); setInfoPdfName("");
    }
  }

  async function pickInfoPdf() {
    try {
      const DocumentPicker = require('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf', copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        setInfoPdf(result.assets[0].uri);
        setInfoPdfName(result.assets[0].name || "document.pdf");
        setInfoImage(null);
      }
    } catch(e) {
      Alert.alert("Erreur","Impossible d'ouvrir le sélecteur de fichiers.");
    }
  }

  async function saveInfo() {
    if(!infoForm.texte?.trim()&&!infoImage&&!infoPdf) return;
    setUploadingInfo(true);
    let imageUrl = null;
    let pdfUrl = null;
    if (infoImage) {
      imageUrl = await uploadFile(infoImage, 'infos', 'image/jpeg', '.jpg');
      if (!imageUrl) { Alert.alert("Erreur","Impossible d'uploader l'image. Vérifiez votre connexion."); setUploadingInfo(false); return; }
    }
    if (infoPdf) {
      pdfUrl = await uploadFile(infoPdf, 'infos', 'application/pdf', '.pdf');
      if (!pdfUrl) { Alert.alert("Erreur","Impossible d'uploader le PDF. Vérifiez votre connexion."); setUploadingInfo(false); return; }
    }
    const id=editInfo?editInfo._id:Date.now().toString();
    const data={
      texte:infoForm.texte.trim(),auteur:user.name,date:todayFmt(),
      ...(imageUrl?{imageUrl}:{}),
      ...(pdfUrl?{pdfUrl,pdfName:infoPdfName}:{}),
      ...(infoForm.adresse?.trim()?{adresse:infoForm.adresse.trim()}:{}),
    };
    await fbSet('infos',id,data);
    if(editInfo) setInfos(is=>is.map(i=>i._id===editInfo._id?{...data,_id:id}:i));
    else setInfos(is=>[...is,{...data,_id:id}]);
    setUploadingInfo(false);
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
    <ScrollView style={{flex:1,backgroundColor:"transparent"}} showsVerticalScrollIndicator={false}>
      <View style={{backgroundColor:"transparent",padding:24,paddingTop:16,paddingBottom:24,borderBottomWidth:1,borderBottomColor:C.border}}>
        <View style={{flexDirection:"row",alignItems:"center",gap:10,marginBottom:6}}>
          <Text style={{color:C.gray,fontSize:12,fontWeight:"700",letterSpacing:2,textTransform:"uppercase"}}>🏐 LESCAR HANDBALL</Text>
          <Image source={require('./assets/LogoLHB.png')} style={{width:120,height:120,resizeMode:'contain'}}/>
        </View>
        <Text style={{fontSize:42,letterSpacing:2,fontWeight:"800",color:C.gold}}>-15F</Text>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
          <Text style={{color:C.white,fontSize:13,fontWeight:"600",marginBottom:8}}>SAISON 2026 – 2027</Text>
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
              <LinearGradient key={info._id}
                colors={["#2D2D2D","#888888","#FFFFFF"]}
                start={{x:0,y:0}} end={{x:1,y:1}}
                style={{borderRadius:14,padding:14,marginBottom:8,borderWidth:2,borderColor:"#FF4444",borderLeftWidth:5,borderLeftColor:"#FF4444"}}>
                <View style={{flexDirection:"row",alignItems:"flex-start",gap:10}}>
                  <Text style={{fontSize:20,marginTop:1}}>🚨</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:"#FF4444",fontWeight:"900",fontSize:11,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>
                      INFO IMPORTANTE !!!
                    </Text>
                    <Text style={{color:"#FFFFFF",fontSize:15,fontWeight:"700",lineHeight:22}}>{info.texte}</Text>
                    {info.imageUrl&&(
                      <TouchableOpacity onPress={()=>Linking.openURL(info.imageUrl)} activeOpacity={0.9}>
                        <Image source={{uri:info.imageUrl}} style={{width:"100%",height:200,borderRadius:10,marginTop:10,resizeMode:"contain"}}/>
                      </TouchableOpacity>
                    )}
                    {info.pdfUrl&&(
                      <AttachmentButton url={info.pdfUrl} label={info.pdfName||"Ouvrir le PDF"} color="#FF4444"/>
                    )}
                    {info.adresse&&(
                      <TouchableOpacity onPress={()=>openNavigation(info.adresse)} style={{marginTop:8}}>
                        <Text style={{color:"#4A148C",fontSize:13,fontWeight:"700",textDecorationLine:"underline"}}>🚘 {info.adresse}</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={{color:"#1A1A1A",fontSize:11,marginTop:6,fontWeight:"600"}}>
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
              </LinearGradient>
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
            {/* Rôles attribués */}
            {Object.keys(nextMatch.roles||{}).filter(r=>(nextMatch.roles||{})[r]).length>0&&(
              <View style={{marginTop:10,borderTopWidth:1,borderTopColor:"rgba(255,255,255,0.15)",paddingTop:8}}>
                <Text style={{color:"rgba(255,255,255,0.6)",fontSize:10,fontWeight:"700",marginBottom:6,textTransform:"uppercase"}}>Rôles attribués</Text>
                {Object.entries(nextMatch.roles||{}).filter(([r,v])=>v&&(Array.isArray(v)?v.length>0:true)).map(([r,v])=>{
                  const list=Array.isArray(v)?v:(v?[v]:[]);
                  const noms=list.map(e=>typeof e==="object"?(e.nom+(e.places?" ("+e.places+"pl)":"")):e).join(", ");
                  return (
                    <View key={r} style={{flexDirection:"row",justifyContent:"space-between",marginBottom:3}}>
                      <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{r}</Text>
                      <Text style={{color:C.gold,fontSize:11,fontWeight:"700"}}>{noms}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </View>

      <View style={{borderBottomWidth:1,borderBottomColor:C.border+"80"}}>
        <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      </View>
      <View style={{paddingHorizontal:14}}>
        <View style={{flexDirection:"row",gap:10,marginBottom:14}}>
          {[
            {label:"Joueuses",val:teamPlayers.length,icon:"👥",color:eq.color},
            {label:"Événements",val:evList.length,icon:"📅",color:C.gold},
          ].map(s=>(
            <Card key={s.label} style={{flex:1,alignItems:"center",padding:12}}>
              <Text style={{fontSize:22}}>{s.icon}</Text>
              <Text style={{fontSize:24,fontWeight:"900",color:s.color,marginTop:2}}>{s.val}</Text>
              <Text style={{fontSize:10,color:C.gray,fontWeight:"700",textTransform:"uppercase"}}>{s.label}</Text>
            </Card>
          ))}
        </View>
        <Card style={{marginBottom:100}}>
          <GoldText style={{fontSize:15,marginBottom:12}}>Cette semaine · {eq.label}</GoldText>
          {upcoming.length===0?<Text style={{color:C.gray,fontSize:13}}>Aucun événement cette semaine.</Text>:upcoming.map(ev=>{
            const tc=TYPE_CONFIG[ev.type]||TYPE_CONFIG.entrainement;
            return (
              <View key={ev._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:tc.light,borderLeftWidth:4,borderLeftColor:tc.color,marginBottom:8}}>
                <Text style={{fontSize:18}}>{tc.icon}</Text>
                <View style={{flex:1}}>
                  <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>{ev.title}</Text>
                  <Text style={{color:C.gray,fontSize:11,marginTop:1}}>{fmtJour(ev.date)} à {ev.heure}{ev.lieu&&<Text onPress={()=>openNavigation(ev.lieu)} style={{color:C.primaryLight,textDecorationLine:"underline"}}> · 🚘 {ev.lieu}</Text>}</Text>
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
        <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":"height"} style={{flex:1}}>
        <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
          <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:18,borderBottomWidth:1,borderBottomColor:"#FF444430"}}>
            <Text style={{color:"#FF4444",fontWeight:"900",fontSize:18}}>🚨 {editInfo?"Modifier":"Nouvelle"} info importante</Text>
            <TouchableOpacity onPress={()=>setShowInfoModal(false)}><Text style={{color:C.gray,fontSize:22}}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView style={{padding:18}} keyboardShouldPersistTaps="handled">
            <Text style={{color:"#FF6666",fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Message</Text>
            <TextInput
              value={infoForm.texte}
              onChangeText={v=>setInfoForm(f=>({...f,texte:v}))}
              placeholder="Ex: Entraînement annulé ce jeudi, RDV vendredi à 18h…"
              placeholderTextColor="#FF444450"
              multiline
              style={{backgroundColor:"#1A0A0A",borderWidth:2,borderColor:"#FF444440",borderRadius:12,padding:14,fontSize:15,color:C.white,minHeight:120,lineHeight:22}}
            />
            {/* Bouton ajout photo */}
            <TouchableOpacity onPress={pickInfoImage}
              style={{flexDirection:"row",alignItems:"center",gap:10,backgroundColor:"#FF444415",borderRadius:10,padding:12,borderWidth:1,borderColor:"#FF444430",marginTop:12}}>
              <Text style={{fontSize:20}}>📷</Text>
              <Text style={{color:"#FF6666",fontWeight:"700",fontSize:13}}>{infoImage?"Changer la photo":"Ajouter une photo"}</Text>
            </TouchableOpacity>
            {/* Bouton ajout PDF */}
            <TouchableOpacity onPress={pickInfoPdf}
              style={{flexDirection:"row",alignItems:"center",gap:10,backgroundColor:"#FF444415",borderRadius:10,padding:12,borderWidth:1,borderColor:"#FF444430",marginTop:8}}>
              <Text style={{fontSize:20}}>📄</Text>
              <Text style={{color:"#FF6666",fontWeight:"700",fontSize:13}}>{infoPdf?"Changer le PDF":"Joindre un PDF"}</Text>
            </TouchableOpacity>
            {/* Aperçu image */}
            {infoImage&&(
              <View style={{marginTop:10,position:"relative"}}>
                <Image source={{uri:infoImage}} style={{width:"100%",height:200,borderRadius:10,resizeMode:"cover"}}/>
                <TouchableOpacity onPress={()=>setInfoImage(null)}
                  style={{position:"absolute",top:6,right:6,backgroundColor:"#FF4444",borderRadius:12,width:24,height:24,alignItems:"center",justifyContent:"center"}}>
                  <Text style={{color:"#fff",fontWeight:"900",fontSize:12}}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            {/* Aperçu PDF */}
            {infoPdf&&(
              <View style={{marginTop:10,flexDirection:"row",alignItems:"center",gap:10,backgroundColor:"#1A0A0A",borderRadius:10,padding:12,borderWidth:1,borderColor:"#FF444440"}}>
                <Text style={{fontSize:28}}>📄</Text>
                <Text style={{flex:1,color:"#FF6666",fontWeight:"700",fontSize:13}} numberOfLines={2}>{infoPdfName}</Text>
                <TouchableOpacity onPress={()=>{setInfoPdf(null);setInfoPdfName("");}}>
                  <Text style={{color:"#FF4444",fontWeight:"900",fontSize:18}}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            {/* Champ adresse */}
            <Text style={{color:"#FF6666",fontSize:11,fontWeight:"700",marginTop:16,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📍 Adresse (optionnel)</Text>
            <TextInput
              value={infoForm.adresse||""}
              onChangeText={v=>setInfoForm(f=>({...f,adresse:v}))}
              placeholder="Ex: 12 rue du Stade, 64230 Lescar"
              placeholderTextColor="#FF444450"
              style={{backgroundColor:"#1A0A0A",borderWidth:2,borderColor:"#FF444440",borderRadius:12,padding:14,fontSize:14,color:C.white}}
            />
            <Text style={{color:"#FF666650",fontSize:11,marginTop:4,marginBottom:8}}>Si renseignée, un bouton de navigation apparaîtra pour les membres.</Text>
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
              <TouchableOpacity onPress={saveInfo} disabled={uploadingInfo}
                style={{flex:1,padding:12,borderRadius:10,backgroundColor:uploadingInfo?"#888":"#FF444425",alignItems:"center",borderWidth:2,borderColor:"#FF4444"}}>
                <Text style={{color:"#FF4444",fontWeight:"900"}}>{uploadingInfo?"⏳ Upload...":"🚨 "+(editInfo?"Modifier":"Publier")}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
        </KeyboardAvoidingView>
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
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe)).sort((a,b)=>(a.order??999)-(b.order??999));
  const filtered=teamPlayers.filter(p=>(p.name||"").toLowerCase().includes(search.toLowerCase()));
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];
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
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:0}}>
        <GoldText style={{fontSize:28}}>Équipe</GoldText>
        <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <View style={{borderBottomWidth:1,borderBottomColor:C.border+"80"}}>
        <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      </View>
      <View style={{flexDirection:"row",gap:10,paddingHorizontal:14,paddingTop:10,paddingBottom:10}}>
        <TextInput value={search} onChangeText={setSearch} placeholder="🔍 Rechercher…" placeholderTextColor={C.gray}
          style={{flex:1,backgroundColor:C.card,borderWidth:1.5,borderColor:C.border,borderRadius:12,padding:10,color:C.text,fontSize:14}}/>
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
                    <Text style={{color:C.text,fontWeight:"700",fontSize:15}}>{p.name}</Text>
                    <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>#{p.num}</Text>
                  </View>
                  {(getRole(user)==="coach"||getRole(user)==="adjoint")&&<Text style={{color:C.primaryLight,fontSize:12,fontWeight:"600",marginTop:1}}>{p.poste}</Text>}
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
                    {canEdit&&<TouchableOpacity onPress={()=>toggle(p)}
                      style={{backgroundColor:p.present?"#0A2A1A":"#2A0A0A",borderRadius:20,paddingHorizontal:10,paddingVertical:4}}>
                      <Text style={{color:p.present?C.green:C.red,fontSize:12,fontWeight:"700"}}>{p.present?"✓ Présente":"✗ Absente"}</Text>
                    </TouchableOpacity>}
                    {canEdit&&<>
                      <View style={{flexDirection:"column",gap:2}}>
                        <TouchableOpacity onPress={()=>{
                          const list=[...teamPlayers];
                          const idx=list.findIndex(x=>x._id===p._id);
                          if(idx===0) return;
                          const prev=list[idx-1];
                          const orderA=idx; const orderB=idx-1;
                          setPlayers(ps=>ps.map(x=>
                            x._id===p._id?{...x,order:orderB}:
                            x._id===prev._id?{...x,order:orderA}:x
                          ));
                          fbSet('players',p._id,{...p,order:orderB});
                          fbSet('players',prev._id,{...prev,order:orderA});
                        }} style={{backgroundColor:C.card2,borderRadius:6,padding:4,alignItems:"center"}}>
                          <Text style={{fontSize:12}}>⬆️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={()=>{
                          const list=[...teamPlayers];
                          const idx=list.findIndex(x=>x._id===p._id);
                          if(idx===list.length-1) return;
                          const next=list[idx+1];
                          const orderA=idx; const orderB=idx+1;
                          setPlayers(ps=>ps.map(x=>
                            x._id===p._id?{...x,order:orderB}:
                            x._id===next._id?{...x,order:orderA}:x
                          ));
                          fbSet('players',p._id,{...p,order:orderB});
                          fbSet('players',next._id,{...next,order:orderA});
                        }} style={{backgroundColor:C.card2,borderRadius:6,padding:4,alignItems:"center"}}>
                          <Text style={{fontSize:12}}>⬇️</Text>
                        </TouchableOpacity>
                      </View>
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
function CalendarView({ events, setEvents, currentEquipe, onEquipeChange, user, taches, adversaires, lieux }) {
  const today=new Date();
  const today2=new Date();
  const [year, setYear]=useState(today2.getFullYear());
  const [month, setMonth]=useState(today2.getMonth());
  const [selDay, setSelDay]=useState(null);
  const [showForm, setShowForm]=useState(false);
  const [editEv, setEditEv]=useState(null);
  const [form, setForm]=useState({});
  const [showRoles, setShowRoles]=useState(null);
  const [placesOpenFor, setPlacesOpenFor]=useState(null);
  const [showAdvModal, setShowAdvModal]=useState(false);
  const [showLieuModal, setShowLieuModal]=useState(false);
  const daysInMonth=getDays(year,month);
  const firstDay=getFirst(year,month);
  const tStr=todayStr();
  const evList=events.filter(e=>isValidEvent(e)&&e.equipe===currentEquipe);
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];
  const canEdit=can(user,"editCalendar");
  const canInscription=can(user,"inscriptionRole");
  // Rôles = tâches du coach + rôles par défaut
  const ROLES_LIST=ROLES_LIST_DEFAULT;

  function evOnDay(d) {
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return evList.filter(e=>e&&e.date&&e.title&&e.date===ds);
  }
  function prevM() { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }
  function nextM() { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }
  function openAdd(day) {
    if(!canEdit) return;
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    setForm({type:"entrainement",title:"",date:ds,heure:"18:00",heureFin:"",lieu:"",adversaire:"",domicile:"true",note:"",equipe:currentEquipe,equipes:[currentEquipe],roles:{}});
    setEditEv(null); setShowForm(true);
  }
  function openEdit(ev) { if(!canEdit) return; setForm({...ev,roles:ev.roles||{}}); setEditEv(ev); setShowForm(true); }
  async function save() {
    if(!form.title?.trim()) return;
    const equipesTarget=form.equipes&&form.equipes.length>0?form.equipes:[currentEquipe];
    if(editEv) {
      // Modification : on garde une seule équipe
      const data={...form,equipe:editEv.equipe};
      const ok=await fbSet('events',editEv._id,data);
      if(!ok){Alert.alert("Erreur d'enregistrement","Vérifiez votre connexion.");return;}
      setEvents(es=>es.map(e=>e._id===editEv._id?{...data,_id:editEv._id}:e));
    } else {
      // Création : un event par équipe sélectionnée
      const newEvs=[];
      for(const eq of equipesTarget) {
        const id=Date.now().toString()+Math.random().toString(36).slice(2,4);
        const data={...form,equipe:eq};
        const ok=await fbSet('events',id,data);
        if(!ok){Alert.alert("Erreur d'enregistrement","Vérifiez votre connexion.");return;}
        newEvs.push({...data,_id:id});
      }
      setEvents(es=>[...es,...newEvs]);
    }
    setShowForm(false);
  }
  async function saveWithRecurrence() {
    if(!form.title?.trim()) return;
    const recurrence=form.recurrence||"none";
    if(recurrence==="none"||editEv) { await save(); return; }
    // Generate recurring events
    // Convert JJ/MM/AA to YYYY-MM-DD
    function toISO(d) { const p=d.trim().split('/'); return p.length===3?`20${p[2]}-${p[1]}-${p[0]}`:d.trim(); }
    const excludes=(form.recurrenceExclude||"").split(",").map(d=>toISO(d)).filter(Boolean);
    // Fin de saison = 30/06 (saison de juillet à juin)
    const startDate=new Date(form.date);
    const finSaison=startDate.getMonth()>=6
      ? new Date(`${startDate.getFullYear()+1}-06-30`)
      : new Date(`${startDate.getFullYear()}-06-30`);
    // La date de fin choisie ne peut pas dépasser la fin de saison
    let endDate=form.recurrenceEnd?new Date(toISO(form.recurrenceEnd)):finSaison;
    if(endDate>finSaison) endDate=finSaison;
    const interval=recurrence==="weekly"?7:14;
    let current=new Date(form.date);
    const newEvents=[];
    while(current<=endDate) {
      const ds=current.toISOString().slice(0,10);
      if(!excludes.includes(ds)) {
        const id=Date.now().toString()+Math.random().toString(36).slice(2,6);
        const data={...form,date:ds,equipe:currentEquipe,recurrenceGroup:form.date};
        delete data.recurrence; delete data.recurrenceEnd; delete data.recurrenceExclude;
        await fbSet('events',id,data);
        newEvents.push({...data,_id:id});
      }
      current.setDate(current.getDate()+interval);
    }
    setEvents(es=>[...es,...newEvents]);
    setShowForm(false);
  }
  async function del(ev) {
    if(!canEdit) return;
    await fbDel('events',ev._id);
    setEvents(es=>es.filter(e=>e._id!==ev._id));
  }
  async function inscriptionRole(ev, role, places=null) {
    if(!canInscription) return;
    const roles=ev.roles||{};
    const userName=user.name;
    // Convertir tout en tableau de strings simples
    let currentList=roles[role]||[];
    if(typeof currentList==="string") currentList=currentList?[currentList]:[];
    // Normaliser en strings
    currentList=currentList.map(e=>typeof e==="object"?(e.nom||""):String(e)).filter(Boolean);
    const isInscrit=currentList.some(e=>e===userName||e.startsWith(userName+" ("));
    let newList;
    if(isInscrit) {
      newList=currentList.filter(e=>e!==userName&&!e.startsWith(userName+" ("));
    } else {
      // Ajouter avec places si fourni
      const entry=places?userName+" ("+places+"pl)":userName;
      newList=[...currentList,entry];
    }
    const updatedRoles={...roles,[role]:newList};
    const updated={...ev,roles:updatedRoles};
    await fbSet('events',ev._id,updated);
    setEvents(es=>es.map(e=>e._id===ev._id?updated:e));
    if(showRoles) setShowRoles(updated);
  }


  const monthEvents=evList.filter(e=>e.date&&e.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).sort((a,b)=>a.date.localeCompare(b.date));

  return (
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:0,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
        <View>
          <GoldText style={{fontSize:28}}>Agenda</GoldText>
          <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
        </View>
        {(getRole(user)==="coach"||getRole(user)==="adjoint")&&(
          <TouchableOpacity onPress={()=>fbGet('events').then(e=>{if(e!=null&&e.length>0)setEvents(e.filter(isValidEvent));})}
            style={{backgroundColor:"rgba(255,255,255,0.15)",borderRadius:20,paddingHorizontal:12,paddingVertical:7,flexDirection:"row",alignItems:"center",gap:6,borderWidth:1,borderColor:"rgba(255,255,255,0.3)"}}>
            <Text style={{fontSize:14}}>🔄</Text>
            <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>Actualiser</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={{borderBottomWidth:1,borderBottomColor:C.border+"80"}}>
        <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      </View>
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
                  <Text style={{fontSize:13,fontWeight:isToday||isSel?"800":"400",color:isSel?C.white:isToday?C.gold:C.text}}>{d}</Text>
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
            {evOnDay(selDay).length===0
              ? <Text style={{color:C.gray,fontSize:13}}>Aucun événement ce jour.</Text>
              : evOnDay(selDay).map(function renderEvDay(ev) {
                if (!ev || !ev._id) return null;
                const evType = ev.type || 'entrainement';
                const tc = TYPE_CONFIG[evType] || TYPE_CONFIG.entrainement;
                const evDate = ev.date || '';
                const todayISO = new Date().toISOString().slice(0,10);
                const evRoles = (ev.roles && typeof ev.roles === 'object') ? ev.roles : {};
                const isMatch = evType === 'match' || evType === 'tournoi';
                const showEdit = canEdit && (evDate >= todayISO || getRole(user) === 'coach');
                return (
                  <TouchableOpacity key={ev._id} activeOpacity={isMatch?0.75:1}
                    onPress={isMatch?()=>setShowRoles(ev):undefined}
                    style={{padding:10,borderRadius:10,backgroundColor:tc.light,borderLeftWidth:3,borderLeftColor:tc.color,marginBottom:6}}>
                    <View style={{flexDirection:"row",alignItems:"center",gap:10}}>
                      <Text style={{fontSize:18}}>{tc.icon}</Text>
                      <View style={{flex:1}}>
                        <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>{ev.title||''}</Text>
                        <Text style={{color:C.gray,fontSize:11}}>{ev.heure||''}{ev.lieu&&<Text onPress={()=>openNavigation(ev.lieu)} style={{color:C.primaryLight,textDecorationLine:"underline"}}> · 🚘 {ev.lieu}</Text>}</Text>
                      </View>
                      {isMatch&&(
                        <View style={{backgroundColor:C.primary,borderRadius:16,paddingHorizontal:8,paddingVertical:4,flexDirection:"row",alignItems:"center",gap:4}}>
                          <Text style={{fontSize:12}}>👆</Text>
                          <Text style={{color:"#fff",fontSize:10,fontWeight:"700"}}>Rôles</Text>
                        </View>
                      )}
                      {showEdit&&<>
                        <TouchableOpacity onPress={(e)=>{e.stopPropagation?.();openEdit(ev);}} style={{padding:5}}><Text>✏️</Text></TouchableOpacity>
                        <TouchableOpacity onPress={(e)=>{e.stopPropagation?.();del(ev);}} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
                        {ev.recurrenceGroup&&<TouchableOpacity onPress={(e)=>{e.stopPropagation?.();
                          Alert.alert("Supprimer la série","Supprimer toutes les séances de cette récurrence ?",[
                            {text:"Annuler",style:"cancel"},
                            {text:"Supprimer tout",style:"destructive",onPress:async()=>{
                              const toDelete=events.filter(e=>e.recurrenceGroup===ev.recurrenceGroup);
                              for(const e of toDelete) await fbDel('events',e._id);
                              setEvents(es=>es.filter(e=>e.recurrenceGroup!==ev.recurrenceGroup));
                            }}
                          ]);
                        }} style={{padding:5}}><Text>🗑️🔄</Text></TouchableOpacity>}
                      </>}
                    </View>
                    {isMatch&&(
                      <View style={{marginTop:8}}>
                        <View style={{backgroundColor:C.card2,borderRadius:8,padding:8,gap:3}}>
                          {ROLES_LIST.map(function renderRole(r) {
                            const rawVal = evRoles[r] || [];
                            const list=Array.isArray(rawVal)?rawVal:(rawVal?[rawVal]:[]);
                            const noms=list.map(e=>typeof e==="object"?(e.nom+(e.places?" ("+e.places+"pl)":"")):e).join(", ");
                            const isMe=list.some(e=>(typeof e==="object"?e.nom:e)===user.name);
                            return (
                              <View key={r} style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingVertical:2}}>
                                <Text style={{color:C.gray,fontSize:11}}>{r}</Text>
                                <Text style={{color:noms?(isMe?C.gold:C.primary):C.border,fontSize:11,fontWeight:noms?"700":"400"}}>{noms||"—"}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
          </Card>
        )}
        <View style={{paddingHorizontal:14,marginBottom:14}}>
          {/* Bandeau inscription rôles */}
          {events.filter(e=>e.equipe===currentEquipe&&(e.type==="match"||e.type==="tournoi")&&e.date>=new Date().toISOString().slice(0,10)).length>0&&(
            <TouchableOpacity onPress={()=>{
              const nextMatch=events.filter(e=>e.equipe===currentEquipe&&(e.type==="match"||e.type==="tournoi")&&e.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date))[0];
              if(nextMatch) setShowRoles(nextMatch);
            }} style={{backgroundColor:C.gold+"25",borderRadius:12,padding:12,marginBottom:12,flexDirection:"row",alignItems:"center",gap:10,borderWidth:1.5,borderColor:C.gold}}>
              <Text style={{fontSize:20}}>👥</Text>
              <View style={{flex:1}}>
                <Text style={{color:C.gold,fontWeight:"700",fontSize:13}}>Inscriptions aux rôles</Text>
                <Text style={{color:C.gray,fontSize:11}}>Appuyez pour vous inscrire au prochain match</Text>
              </View>
              <Text style={{color:C.gold,fontSize:16}}>→</Text>
            </TouchableOpacity>
          )}
          <GoldText style={{fontSize:15,marginBottom:10}}>🔗 Championnats FFHB</GoldText>
          <TouchableOpacity onPress={()=>Linking.openURL(LIEN_E1)}
            style={{flexDirection:"row",alignItems:"center",gap:10,padding:14,borderRadius:12,backgroundColor:"#C9A22720",borderWidth:1.5,borderColor:"#C9A227",marginBottom:10}}>
            <Image source={require('./assets/Horacek.jpg')} style={{width:36,height:36,borderRadius:18,resizeMode:"cover"}}/>
            <View style={{flex:1}}>
              <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>Championnat Équipe 1</Text>
              <Text style={{color:C.gray,fontSize:11,marginTop:2}}>Voir sur FFHB →</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>Linking.openURL(LIEN_E2)}
            style={{flexDirection:"row",alignItems:"center",gap:10,padding:14,borderRadius:12,backgroundColor:"#6C3FC520",borderWidth:1.5,borderColor:"#6C3FC5",marginBottom:14}}>
            <Image source={require('./assets/Sako.jpg')} style={{width:36,height:36,borderRadius:18,resizeMode:"cover"}}/>
            <View style={{flex:1}}>
              <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>Championnat Équipe 2</Text>
              <Text style={{color:C.gray,fontSize:11,marginTop:2}}>Voir sur FFHB →</Text>
            </View>
          </TouchableOpacity>
          <View style={{flexDirection:"row",alignItems:"center",gap:8,marginBottom:10}}>
            <View style={{width:8,height:8,borderRadius:4,backgroundColor:eq.color}}/>
            <GoldText style={{fontSize:15}}>Événements {eq.label} — {MONTHS[month]}</GoldText>
          </View>
          {monthEvents.length===0?<Text style={{color:C.gray,fontSize:13}}>Aucun événement ce mois.</Text>:monthEvents.map(function(ev){
            if(!ev||!ev.date) return null;
            const tc=TYPE_CONFIG[ev.type]||TYPE_CONFIG.entrainement;
            const evIsPast=(ev.date||"")<new Date().toISOString().slice(0,10);
            const isMatch=ev.type==="match"||ev.type==="tournoi";
            return (
              <TouchableOpacity key={ev._id} activeOpacity={isMatch?0.75:1}
                onPress={isMatch?()=>setShowRoles(ev):undefined}
                style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,borderLeftWidth:4,borderLeftColor:evIsPast?"#9CA3AF":tc.color,opacity:evIsPast?0.6:1,flexDirection:"row",alignItems:"center",gap:10}}>
                <Text style={{fontSize:20}}>{tc.icon}</Text>
                <View style={{flex:1}}>
                  <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>{ev.title}</Text>
                  <Text style={{color:C.gray,fontSize:11}}>{fmtJour(ev.date)} à {ev.heure}{ev.lieu&&<Text onPress={()=>openNavigation(ev.lieu)} style={{color:C.primaryLight,textDecorationLine:"underline"}}> · 🚘 {ev.lieu}</Text>}</Text>
                </View>
                {isMatch?(
                  <View style={{backgroundColor:C.primary,borderRadius:16,paddingHorizontal:8,paddingVertical:4,flexDirection:"row",alignItems:"center",gap:4}}>
                    <Text style={{fontSize:12}}>👆</Text>
                    <Text style={{color:"#fff",fontSize:10,fontWeight:"700"}}>Rôles</Text>
                  </View>
                ):(
                  <View style={{backgroundColor:tc.color+"25",borderRadius:20,paddingHorizontal:8,paddingVertical:3}}>
                    <Text style={{color:tc.color,fontSize:10,fontWeight:"700"}}>{tc.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{height:100}}/>
      </ScrollView>

      {/* MODAL RÔLES */}
      <ModalWrapper open={!!showRoles} onClose={()=>setShowRoles(null)} title={showRoles?.title||"Rôles"}>
        {showRoles&&(
          <>
            <Text style={{color:C.gray,fontSize:13,marginBottom:4}}>{fmt(showRoles.date)} · {showRoles.heure||''}{showRoles.heureFin?' → '+showRoles.heureFin:''} · {showRoles.lieu}</Text>
            {isEventOver(showRoles)&&(
              <View style={{backgroundColor:"#FEF2F2",borderRadius:10,padding:10,marginBottom:12,borderWidth:1,borderColor:C.red}}>
                <Text style={{color:C.red,fontWeight:"700",fontSize:13,textAlign:"center"}}>⏱ Événement terminé — inscriptions closes</Text>
              </View>
            )}
            {ROLES_LIST.map(role=>{
              const rawVal=(showRoles.roles||{})[role]||[];
              let inscrits=[];
              if(typeof rawVal==="string") inscrits=rawVal?[rawVal]:[];
              else if(Array.isArray(rawVal)) inscrits=rawVal.map(e=>typeof e==="object"?(e.nom||(e.places?e.nom+" ("+e.places+"pl)":""))+"":String(e||"")).filter(Boolean);
              const isCovoiturage=role.includes("je conduis");
              const isMe=inscrits.some(e=>String(e).startsWith(user.name));
              const over=isEventOver(showRoles);
              const placesVisible=placesOpenFor===role;
              return (
                <View key={role} style={{marginBottom:10}}>
                  <View style={{borderRadius:12,backgroundColor:over?"#F3F4F6":isMe?C.green+"20":C.card2,borderWidth:1.5,borderColor:over?"#D1D5DB":isMe?C.green:C.border,overflow:"hidden"}}>
                    <View style={{flexDirection:"row",alignItems:"center",gap:12,padding:12}}>
                      <View style={{width:40,height:40,borderRadius:20,backgroundColor:isMe?C.green+"30":C.card,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:isMe?C.green:C.border}}>
                        <Text style={{fontSize:20}}>{/\p{Emoji}/u.test(role[0])?role.split(' ')[0]:"📌"}</Text>
                      </View>
                      <View style={{flex:1}}>
                        <Text style={{color:over?C.gray:C.text,fontWeight:"700",fontSize:14}}>{/\p{Emoji}/u.test(role[0])?role.substring(role.indexOf(' ')+1):role}</Text>
                        {inscrits.length===0&&<Text style={{color:C.gray,fontSize:12,marginTop:2}}>Disponible</Text>}
                        {inscrits.map((nom,i)=>(
                          <Text key={i} style={{color:nom.startsWith(user.name)?C.green:C.primaryLight,fontSize:12,marginTop:1}}>
                            {nom.startsWith(user.name)?"✓ Vous":("👤 "+nom)}
                          </Text>
                        ))}
                      </View>
                      {!over&&canInscription&&!isMe&&(
                        <TouchableOpacity
                          onPress={()=>isCovoiturage?setPlacesOpenFor(placesVisible?null:role):inscriptionRole(showRoles,role)}
                          style={{backgroundColor:C.green+"20",borderRadius:10,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:C.green}}>
                          <Text style={{color:C.green,fontWeight:"700",fontSize:12}}>{isCovoiturage?(placesVisible?"▲":"🚗 Places"):"S'inscrire"}</Text>
                        </TouchableOpacity>
                      )}
                      {!over&&canInscription&&isMe&&(
                        <TouchableOpacity onPress={()=>inscriptionRole(showRoles,role)}
                          style={{backgroundColor:C.red+"20",borderRadius:10,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:C.red}}>
                          <Text style={{color:C.red,fontWeight:"700",fontSize:12}}>Se désinscrire</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  {isCovoiturage&&placesVisible&&(
                    <View style={{backgroundColor:C.card2,borderRadius:12,padding:12,marginTop:4,borderWidth:1,borderColor:C.green}}>
                      <Text style={{color:C.green,fontWeight:"700",fontSize:12,marginBottom:8}}>🚗 Combien de places ?</Text>
                      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>
                        {["1","2","3","4","5","5+"].map(p=>(
                          <TouchableOpacity key={p} onPress={()=>{inscriptionRole(showRoles,role,p);setPlacesOpenFor(null);}}
                            style={{flex:1,minWidth:50,paddingVertical:10,borderRadius:10,backgroundColor:C.green+"25",borderWidth:2,borderColor:C.green,alignItems:"center"}}>
                            <Text style={{color:C.green,fontWeight:"900",fontSize:16}}>{p}</Text>
                            <Text style={{color:C.green,fontSize:9}}>pl</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity onPress={()=>setPlacesOpenFor(null)} style={{marginTop:8,alignItems:"center"}}>
                        <Text style={{color:C.gray,fontSize:12}}>Annuler</Text>
                      </TouchableOpacity>
                    </View>
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
                <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>{v.icon} {v.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Titre" value={form.title||""} onChangeText={v=>setForm(f=>({...f,title:v}))}/>
          {!editEv&&(
            <>
              <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Attribuer à</Text>
              <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:14}}>
                {EQUIPES.map(eq=>{
                  const selected=(form.equipes||[]).includes(eq.id);
                  return (
                    <TouchableOpacity key={eq.id} onPress={()=>{
                      const current=form.equipes||[];
                      const updated=selected?current.filter(e=>e!==eq.id):[...current,eq.id];
                      setForm(f=>({...f,equipes:updated.length>0?updated:[eq.id]}));
                    }} style={{flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:12,paddingVertical:8,borderRadius:20,borderWidth:2,
                      borderColor:selected?eq.color:C.border,
                      backgroundColor:selected?eq.color+"25":C.card2}}>
                      <Text style={{color:selected?eq.color:C.gray,fontWeight:"700",fontSize:12}}>{eq.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
          <View style={{flexDirection:"row",gap:10}}>
            <View style={{flex:1}}><Input label="Date" value={form.date||""} onChangeText={v=>setForm(f=>({...f,date:v}))} placeholder="AAAA-MM-JJ"/></View>
            <View style={{flex:1}}><Input label="Début" value={form.heure||""} onChangeText={v=>setForm(f=>({...f,heure:v}))} placeholder="HH:MM"/></View>
            <View style={{flex:1}}><Input label="Fin" value={form.heureFin||""} onChangeText={v=>setForm(f=>({...f,heureFin:v}))} placeholder="HH:MM"/></View>
          </View>
          <>
              <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Lieu</Text>
              <TouchableOpacity onPress={()=>setShowLieuModal(true)}
                style={{backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Text style={{color:form.lieu?C.white:C.gray,fontSize:14}}>
                  {form.lieu?"📍 "+form.lieu:"Sélectionner un lieu…"}
                </Text>
                <Text style={{color:C.gold,fontSize:16}}>▼</Text>
              </TouchableOpacity>
              {showLieuModal&&(
                <Modal visible={true} transparent animationType="fade" onRequestClose={()=>setShowLieuModal(false)}>
                  <TouchableOpacity style={{flex:1,backgroundColor:"rgba(0,0,0,0.7)",justifyContent:"center",padding:24}} onPress={()=>setShowLieuModal(false)}>
                    <View style={{backgroundColor:"#FFFFFF",borderRadius:16,padding:16,borderWidth:1.5,borderColor:C.border}}>
                      <GoldText style={{fontSize:16,marginBottom:12}}>Choisir un lieu</GoldText>
                      <ScrollView style={{maxHeight:300}}>
                        {[...LIEUX_FIXES,...(lieux||[]).filter(l=>!LIEUX_FIXES.find(f=>f.nom===l.nom))].map(l=>(
                          <TouchableOpacity key={l._id} onPress={()=>{setForm(f=>({...f,lieu:l.nom}));setShowLieuModal(false);}}
                            style={{padding:14,borderRadius:10,backgroundColor:form.lieu===l.nom?C.primary+"20":"#F5F5F5",marginBottom:6,borderWidth:1,borderColor:form.lieu===l.nom?C.primary:"#E0E0E0"}}>
                            <Text style={{color:form.lieu===l.nom?C.primary:"#1A1A1A",fontWeight:"700",fontSize:14}}>📍 {l.nom}{l.adresse?" · "+l.adresse:""}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity onPress={()=>{setForm(f=>({...f,lieu:""}));setShowLieuModal(false);}}
                          style={{padding:14,borderRadius:10,backgroundColor:C.card2,marginBottom:6,borderWidth:1,borderColor:C.border}}>
                          <Text style={{color:C.gray,fontSize:14}}>✕ Aucun</Text>
                        </TouchableOpacity>
                      </ScrollView>
                    </View>
                  </TouchableOpacity>
                </Modal>
              )}
              <Input placeholder="Ou saisissez un lieu libre…" value={(lieux||[]).find(l=>l.nom===form.lieu)?"":(form.lieu||"")} onChangeText={v=>setForm(f=>({...f,lieu:v}))}/>
            </>
          }
          {form.type==="match"&&(
            <>
              <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Adversaire</Text>
              <TouchableOpacity onPress={()=>setShowAdvModal(true)}
                style={{backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Text style={{color:form.adversaire?C.white:C.gray,fontSize:14}}>
                  {form.adversaire?"⚔️ "+form.adversaire:"Sélectionner un adversaire…"}
                </Text>
                <Text style={{color:C.gold,fontSize:16}}>▼</Text>
              </TouchableOpacity>
              {showAdvModal&&(
                <Modal visible={true} transparent animationType="fade" onRequestClose={()=>setShowAdvModal(false)}>
                  <TouchableOpacity style={{flex:1,backgroundColor:"rgba(0,0,0,0.7)",justifyContent:"center",padding:24}} onPress={()=>setShowAdvModal(false)}>
                    <View style={{backgroundColor:"#FFFFFF",borderRadius:16,padding:16,borderWidth:1.5,borderColor:C.border}}>
                      <GoldText style={{fontSize:16,marginBottom:12}}>Choisir un adversaire</GoldText>
                      <ScrollView style={{maxHeight:300}}>
                        {[...ADVERSAIRES_FIXES,...(adversaires||[]).filter(a=>!ADVERSAIRES_FIXES.find(f=>f.nom===a.nom))].map(a=>(
                          <TouchableOpacity key={a._id} onPress={()=>{setForm(f=>({...f,adversaire:a.nom}));setShowAdvModal(false);}}
                            style={{padding:14,borderRadius:10,backgroundColor:form.adversaire===a.nom?C.red+"20":"#F5F5F5",marginBottom:6,borderWidth:1,borderColor:form.adversaire===a.nom?C.red:"#E0E0E0"}}>
                            <Text style={{color:form.adversaire===a.nom?C.red:"#1A1A1A",fontWeight:"700",fontSize:14}}>⚔️ {a.nom}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity onPress={()=>{setForm(f=>({...f,adversaire:""}));setShowAdvModal(false);}}
                          style={{padding:14,borderRadius:10,backgroundColor:"#F5F5F5",marginBottom:6,borderWidth:1,borderColor:"#E0E0E0"}}>
                          <Text style={{color:"#888",fontSize:14}}>✕ Aucun</Text>
                        </TouchableOpacity>
                      </ScrollView>
                    </View>
                  </TouchableOpacity>
                </Modal>
              )}
              <Input placeholder="Ou saisissez un adversaire libre…" value={(adversaires||[]).find(a=>a.nom===form.adversaire)?"":(form.adversaire||"")} onChangeText={v=>setForm(f=>({...f,adversaire:v}))}/>
              <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase"}}>Lieu du match</Text>
              <View style={{flexDirection:"row",gap:10,marginBottom:14}}>
                <TouchableOpacity onPress={()=>setForm(f=>({...f,domicile:"true"}))}
                  style={{flex:1,padding:12,borderRadius:12,alignItems:"center",borderWidth:2,
                    borderColor:form.domicile==="true"?C.green:C.border,
                    backgroundColor:form.domicile==="true"?C.green+"20":C.card2}}>
                  <Text style={{fontSize:20}}>🏠</Text>
                  <Text style={{color:form.domicile==="true"?C.green:C.gray,fontWeight:"700",fontSize:13,marginTop:4}}>Domicile</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>setForm(f=>({...f,domicile:"false"}))}
                  style={{flex:1,padding:12,borderRadius:12,alignItems:"center",borderWidth:2,
                    borderColor:form.domicile==="false"?C.orange:C.border,
                    backgroundColor:form.domicile==="false"?C.orange+"20":C.card2}}>
                  <Text style={{fontSize:20}}>✈️</Text>
                  <Text style={{color:form.domicile==="false"?C.orange:C.gray,fontWeight:"700",fontSize:13,marginTop:4}}>Extérieur</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          <Input label="Notes" value={form.note||""} onChangeText={v=>setForm(f=>({...f,note:v}))} multiline style={{minHeight:70}}/>

          {/* RÉCURRENCE */}
          {form.type==="entrainement"&&!editEv&&(
            <View style={{marginBottom:14}}>
              <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:8,textTransform:"uppercase"}}>Récurrence</Text>
              <View style={{flexDirection:"row",gap:8,marginBottom:10}}>
                {[{key:"none",label:"Aucune"},{key:"weekly",label:"Hebdo"},{key:"biweekly",label:"2 sem."}].map(r=>(
                  <TouchableOpacity key={r.key} onPress={()=>setForm(f=>({...f,recurrence:r.key}))}
                    style={{flex:1,padding:8,borderRadius:10,borderWidth:1.5,
                      borderColor:(form.recurrence||"none")===r.key?C.primary:C.border,
                      backgroundColor:(form.recurrence||"none")===r.key?C.primary+"20":C.card2,
                      alignItems:"center"}}>
                    <Text style={{color:(form.recurrence||"none")===r.key?C.primary:C.gray,fontWeight:"700",fontSize:12}}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {(form.recurrence==="weekly"||form.recurrence==="biweekly")&&(
                <>
                  <Input label="Jusqu'au (date de fin)" value={form.recurrenceEnd||""} onChangeText={v=>setForm(f=>({...f,recurrenceEnd:v}))} placeholder="30/06/27"/>
                  <Text style={{color:C.gold,fontSize:11,fontWeight:"700",marginBottom:6,textTransform:"uppercase"}}>Dates à exclure (vacances…)</Text>
                  <Input value={form.recurrenceExclude||""} onChangeText={v=>setForm(f=>({...f,recurrenceExclude:v}))} placeholder="28/10/26, 04/11/26, …" multiline/>
                  <Text style={{color:C.gray,fontSize:11,marginTop:4,marginBottom:8}}>Séparez les dates par des virgules (format JJ/MM/AA)</Text>
                </>
              )}
            </View>
          )}

          <View style={{flexDirection:"row",gap:10,marginBottom:40}}>
            <Btn variant="secondary" onPress={()=>setShowForm(false)} style={{flex:1}}>Annuler</Btn>
            <Btn onPress={saveWithRecurrence} style={{flex:1}}>Enregistrer</Btn>
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
  const [pendingStatuts, setPendingStatuts]=useState({}); // {histId: statut} — changements en cours

  // Charger l'historique des présences + auto-refresh 10s
  async function loadHistory() {
    const h=await fbGet('presencesHistory');
    if(h!=null) setHistory(h); // null = erreur Firestore, on garde l'existant
  }
  useEffect(()=>{
    loadHistory();
  },[currentEquipe]);
  // Réinitialiser les statuts en cours quand on change de séance
  useEffect(()=>{ setPendingStatuts({}); },[selEv?._id]);
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe)).sort((a,b)=>(a.order??999)-(b.order??999));
  const canEdit=can(user,"managePresences");
  const role=getRole(user);
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];

  // Événements du mois sélectionné pour cette équipe
  const monthStr=`${year}-${String(month+1).padStart(2,"0")}`;
  const today3=new Date();
  const twoWeeksLater=new Date(today3); twoWeeksLater.setDate(today3.getDate()+14);
  const twoWeeksStr=twoWeeksLater.toISOString().slice(0,10);
  const todayStr3=today3.toISOString().slice(0,10);
  const monthEvents=events.filter(e=>{
    if(!e||!e.equipe||e.equipe!==currentEquipe||!e.date||typeof e.date!=='string'||!e.date.startsWith(monthStr)) return false;
    if(e.type==="entrainement") {
      // Show past ones (greyed) + upcoming 2 weeks
      const isPastEv=e.date<todayStr3;
      return isPastEv || e.date<=twoWeeksStr;
    }
    return false; // matchs, tournois, réunions exclus de l'appel
  }).sort((a,b)=>a.date.localeCompare(b.date));

  const pCount=teamPlayers.filter(p=>getStatut(p)==="present").length;
  const aCount=teamPlayers.filter(p=>getStatut(p)==="absent").length;
  const rCount=teamPlayers.filter(p=>getStatut(p)==="retard").length;

  function canEditPlayer(p) {
    if(canEdit) return true; // coach et adjoint avec permission
    // Les parents peuvent TOUJOURS faire l'appel de leur enfant (sans permission requise)
    if(role==="parent") {
      if(isEventOver(selEv)) return false; // appel clos si événement terminé
      // Si l'appel a déjà été validé par le coach, le parent ne peut plus modifier
      if(selEv) {
        const histId=selEv._id+"_"+p._id;
        const existing=history.find(h=>h._id===histId);
        if(existing&&existing.valide===true) return false;
      }
      const email=(user.email||"").toLowerCase().trim();
      const ep1=(p.emailParent1||"").toLowerCase().trim();
      const ep2=(p.emailParent2||"").toLowerCase().trim();
      const name=(user.name||"").toLowerCase().trim();
      const p1=(p.parent1||"").toLowerCase().trim();
      const p2=(p.parent2||"").toLowerCase().trim();
      return (ep1&&ep1===email)||(ep2&&ep2===email)||
             (p1&&p1===name)||(p2&&p2===name);
    }
    return false;
  }

  async function setStatut(p, statut) {
    if(!canEditPlayer(p)) return;
    if(!selEv) return;
    const evId=selEv._id;
    const evDate=selEv.date;
    const evTitle=selEv.title;
    const histId=evId+"_"+p._id;
    const entry={
      _id:histId, playerId:p._id, playerName:p.name,
      date:evDate, eventId:evId, eventTitle:evTitle,
      statut, equipes:Array.isArray(p.equipes)?p.equipes:[],
      valide:false, // pas encore validé
    };
    // Stocker dans pendingStatuts (source de vérité pour l'affichage en cours)
    setPendingStatuts(prev=>({...prev,[histId]:statut}));
    // Mise à jour history aussi pour cohérence
    setHistory(hs=>{
      const filtered=hs.filter(h=>h._id!==histId);
      return [...filtered,entry];
    });
    // Sauvegarde Firestore en arrière-plan
    await fbSet('presencesHistory',histId,entry);
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
        valide:false,
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

  // Valide l'appel : enregistre TOUT LE MONDE avec pendingStatuts comme source de vérité
  async function validerAppel() {
    if(!canEdit||!selEv) return;
    const evId=selEv._id;
    const evDate=selEv.date;
    const newEntries=[];
    for(const p of teamPlayers) {
      const histId=evId+"_"+p._id;
      // pendingStatuts en priorité, sinon history, sinon "present"
      let statutActuel = pendingStatuts[histId];
      if(statutActuel===undefined) {
        const existing=history.find(h=>h.eventId===evId&&h.playerId===p._id);
        statutActuel=existing?existing.statut:"present";
      }
      const entry={
        _id:histId,playerId:p._id,playerName:p.name,date:evDate,
        eventId:evId,eventTitle:selEv.title,
        statut:statutActuel,equipes:Array.isArray(p.equipes)?p.equipes:[],
        valide:true, // appel validé
      };
      newEntries.push(entry);
    }
    // Mise à jour locale
    setHistory(hs=>{
      const ids=newEntries.map(e=>e._id);
      return [...hs.filter(h=>!ids.includes(h._id)),...newEntries];
    });
    // Vider pendingStatuts après validation
    setPendingStatuts({});
    // Sauvegarde Firestore
    for(const entry of newEntries) {
      await fbSet('presencesHistory',entry._id,entry);
    }
    Alert.alert("Appel validé","L'appel a bien été enregistré pour "+teamPlayers.length+" joueuses.");
  }

  async function deverrouillerAppel() {
    if(role!=="coach"||!selEv) return;
    Alert.alert(
      "Déverrouiller l'appel",
      "Les parents pourront à nouveau modifier la présence de leur enfant. Confirmer ?",
      [
        {text:"Annuler",style:"cancel"},
        {text:"Déverrouiller",style:"destructive",onPress:async()=>{
          const evId=selEv._id;
          const toUpdate=history.filter(h=>h.eventId===evId&&h.valide===true);
          const updated=toUpdate.map(h=>({...h,valide:false}));
          setHistory(hs=>{
            const ids=updated.map(e=>e._id);
            return [...hs.filter(h=>!ids.includes(h._id)),...updated];
          });
          for(const entry of updated) {
            await fbSet('presencesHistory',entry._id,entry);
          }
          Alert.alert("Déverrouillé","Les parents peuvent à nouveau faire l'appel.");
        }}
      ]
    );
  }

  function getStatut(p) {
    if(!selEv) return "present";
    const evId=selEv._id;
    const histId=evId+"_"+p._id;
    // pendingStatuts a priorité (changements en cours de séance)
    if(pendingStatuts[histId]!==undefined) return pendingStatuts[histId];
    const entry=history.find(h=>h.eventId===evId&&h.playerId===p._id);
    return entry?entry.statut:"present";
  }
  function statutColor(p) {
    const s=getStatut(p);
    return s==="present"?C.green:s==="retard"?"#FB923C":C.red;
  }

  const STATUTS_COACH=[
    {key:"present",label:"Présente", color:C.green, bg:"#0A2A1A",icon:"✓"},
    {key:"absent", label:"Absente",  color:C.red,   bg:"#2A0A0A",icon:"✗"},
    {key:"retard", label:"En retard",color:"#FB923C",bg:"#FFF7ED",icon:"⏱"},
  ];
  const STATUTS_PARENT=[
    {key:"absent",  label:"Absente",   color:C.red,   bg:"#2A0A0A",icon:"✗"},
    {key:"retard",  label:"En retard", color:"#FB923C",bg:"#FFF7ED",icon:"⏱"},
  ];
  function getStatuts() { return role==="parent"?STATUTS_PARENT:STATUTS_COACH; }

  function prevM() { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }
  function nextM() { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }

  const TYPE_ICONS={match:"⚔️",entrainement:"🏃",rdv:"📅",tournoi:"🏆"};

  return (
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:0,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
        <View>
          <GoldText style={{fontSize:28}}>Feuille d'appel</GoldText>
          <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
        </View>
        {(role==="coach"||role==="adjoint")&&(
          <TouchableOpacity onPress={loadHistory}
            style={{backgroundColor:C.card,borderRadius:20,paddingHorizontal:12,paddingVertical:6,flexDirection:"row",alignItems:"center",gap:6,borderWidth:1,borderColor:C.border}}>
            <Text style={{fontSize:14}}>🔄</Text>
            <Text style={{color:C.gold,fontSize:12,fontWeight:"700"}}>Actualiser</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={{borderBottomWidth:1,borderBottomColor:C.border+"80"}}>
        <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
      </View>
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
            const evIsPast=ev.date<todayStr();
            return (
              <TouchableOpacity key={ev._id} onPress={()=>setSelEv(isSel?null:ev)}
                style={{flexDirection:"row",alignItems:"center",gap:12,padding:14,borderRadius:14,
                  backgroundColor:isSel?tc.color+"25":C.card,
                  borderWidth:2,borderColor:isSel?tc.color:C.border,marginBottom:8,
                  opacity:evIsPast&&!isSel?0.7:1}}>
                <View style={{width:46,height:46,borderRadius:12,backgroundColor:tc.color+"20",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:tc.color}}>
                  <Text style={{fontSize:20}}>{tc.icon}</Text>
                  <Text style={{color:tc.color,fontSize:9,fontWeight:"800"}}>{ev.date.split("-")[2]}/{ev.date.split("-")[1]}</Text>
                </View>
                <View style={{flex:1}}>
                  <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>{ev.title}</Text>
                  <Text style={{color:C.gray,fontSize:11,marginTop:2}}>{fmtJour(ev.date)} à {ev.heure}</Text>
                  {ev.lieu?<Text onPress={()=>openNavigation(ev.lieu)} style={{color:C.primaryLight,fontSize:11,textDecorationLine:"underline"}}>🚘 {ev.lieu}</Text>:null}
                </View>
                <View style={{alignItems:"center",gap:4}}>
                  <View style={{backgroundColor:isSel?tc.color:isEventOver(ev)?"#9CA3AF":C.card2,borderRadius:20,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:isEventOver(ev)?"#9CA3AF":tc.color}}>
                    <Text style={{color:isSel?C.white:isEventOver(ev)?C.white:tc.color,fontWeight:"700",fontSize:11}}>{isSel?"✓ Sélectionné":isEventOver(ev)?"⏱ Terminé":"Faire l'appel"}</Text>
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
                <Text style={{color:C.gold,fontSize:11,fontWeight:"700",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{isEventOver(selEv)?"⏱ Séance terminée":"Appel en cours"}</Text>
                <Text style={{color:C.text,fontWeight:"800",fontSize:16}}>{selEv.title}</Text>
                <Text style={{color:C.gray,fontSize:12}}>{fmtJour(selEv.date)} · {selEv.heure||''}{selEv.heureFin?' → '+selEv.heureFin:''}</Text>
              </Card>
            </View>
            {isEventOver(selEv)&&role==="parent"&&(
              <View style={{marginHorizontal:14,marginBottom:10,backgroundColor:"#FEF2F2",borderRadius:10,padding:12,borderWidth:1,borderColor:C.red}}>
                <Text style={{color:C.red,fontWeight:"700",fontSize:13,textAlign:"center"}}>⏱ Cette séance est terminée — appel clos</Text>
              </View>
            )}

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
                <Text style={{color:C.text,fontWeight:"700"}}>
                  <Text style={{color:C.gold}}>{pCount}</Text>/{teamPlayers.length} présentes
                </Text>
              </View>
              {canEdit&&<Text style={{color:C.gray,fontSize:11,marginBottom:8}}>Tout le monde est présent par défaut. Marquez les absences/retards, puis validez.</Text>}
              {canEdit&&(
                <TouchableOpacity onPress={validerAppel} activeOpacity={0.8}
                  style={{backgroundColor:C.gold,borderRadius:10,paddingVertical:12,alignItems:"center",justifyContent:"center",marginBottom:10}}>
                  <Text style={{color:"#0D0D1A",fontWeight:"800",fontSize:15}}>✓ Valider l'appel</Text>
                </TouchableOpacity>
              )}
              {role==="coach"&&history.some(h=>h.eventId===selEv?._id&&h.valide===true)&&(
                <TouchableOpacity onPress={deverrouillerAppel} activeOpacity={0.8}
                  style={{backgroundColor:C.card2,borderRadius:10,paddingVertical:10,alignItems:"center",justifyContent:"center",marginBottom:10,borderWidth:1,borderColor:C.orange}}>
                  <Text style={{color:C.orange,fontWeight:"700",fontSize:13}}>🔓 Déverrouiller l'appel</Text>
                </TouchableOpacity>
              )}
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
                        <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>{p.name}</Text>
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
                          <TouchableOpacity key={s.key} onPress={()=>setStatut(p, getStatut(p)===s.key?"present":s.key)}
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
  const [attachment, setAttachment]=useState(null);   // {uri, name, type: 'image'|'pdf'}
  const [uploading, setUploading]=useState(false);

  async function refreshMessages() {
    setRefreshing(true);
    const fresh=await fbGet('messages');
    if(fresh!=null) setMessages(fresh);
    setRefreshing(false);
  }

  useEffect(()=>{
    refreshMessages();
    const interval=setInterval(refreshMessages, 300000); // 5 minutes
    return ()=>clearInterval(interval);
  },[currentEquipe]);
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];
  const msgList=messages.filter(m=>m.equipe===currentEquipe).sort((a,b)=>b._id.localeCompare(a._id));
  const canSend=true;
  const role=getRole(user);

  async function pickMsgImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission refusée","Autorisez l'accès à la galerie."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets[0]) {
      setAttachment({uri:result.assets[0].uri, name:"photo.jpg", type:"image"});
    }
  }

  async function pickMsgPdf() {
    try {
      const DocumentPicker = require('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf', copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        setAttachment({uri:result.assets[0].uri, name:result.assets[0].name||"document.pdf", type:"pdf"});
      }
    } catch(e) {
      Alert.alert("Erreur","Impossible d'ouvrir le sélecteur de fichiers.");
    }
  }

  async function send() {
    if(!newMsg.trim()&&!attachment) return;
    if(!canSend) return;
    setUploading(true);
    let fileUrl = null;
    let fileName = null;
    let fileType = null;
    if (attachment) {
      const mimeType = attachment.type==="pdf" ? "application/pdf" : "image/jpeg";
      const ext = attachment.type==="pdf" ? ".pdf" : ".jpg";
      fileUrl = await uploadFile(attachment.uri, 'messages', mimeType, ext);
      if (!fileUrl) { Alert.alert("Erreur","Impossible d'uploader le fichier."); setUploading(false); return; }
      fileName = attachment.name;
      fileType = attachment.type;
    }
    const id=Date.now().toString();
    const label=role==="coach"?"👑 Coach":role==="adjoint"?"🎽 "+user.name:"👪 "+user.name;
    const data={
      auteur:label, texte:newMsg.trim(), date:todayFmt(), heure:timeStr(), equipe:currentEquipe,
      ...(fileUrl?{fileUrl,fileName,fileType}:{}),
    };
    await fbSet('messages',id,data);
    setMessages(ms=>[...ms,{...data,_id:id}]);
    setNewMsg(""); setAttachment(null);
    setUploading(false);
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
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"} keyboardVerticalOffset={90}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:10,paddingBottom:8,borderBottomWidth:0}}>
        <GoldText style={{fontSize:24}}>Messagerie</GoldText>
        <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <ScrollView style={{flex:1}} showsVerticalScrollIndicator={false}>
        <EquipeSelector currentEquipe={currentEquipe} onSelect={onEquipeChange}/>
        <View style={{paddingHorizontal:14}}>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:0,marginBottom:4}}>
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
                <Text style={{color:C.text,fontSize:14,lineHeight:20}}>{msg.texte}</Text>
                {msg.fileUrl&&msg.fileType==="image"&&(
                  <TouchableOpacity onPress={()=>Linking.openURL(msg.fileUrl)} activeOpacity={0.9} style={{marginTop:8}}>
                    <Image source={{uri:msg.fileUrl}} style={{width:"100%",height:180,borderRadius:10,resizeMode:"cover"}}/>
                    <Text style={{color:C.gray,fontSize:11,marginTop:4,textAlign:"center"}}>📥 Appuyer pour ouvrir / télécharger</Text>
                  </TouchableOpacity>
                )}
                {msg.fileUrl&&msg.fileType==="pdf"&&(
                  <AttachmentButton url={msg.fileUrl} label={msg.fileName||"Ouvrir le PDF"} color={ms.nameColor}/>
                )}
              </View>
            </View>
          );
        })}
        <View style={{height:100}}/>
        </View>
      </ScrollView>
      {canSend&&(
        <View style={{padding:14,backgroundColor:"#F0EBFF",borderTopWidth:2,borderTopColor:C.primary}}>
          {/* Aperçu pièce jointe en cours */}
          {attachment&&(
            <View style={{flexDirection:"row",alignItems:"center",gap:8,backgroundColor:"#E0D7FF",borderRadius:10,padding:8,marginBottom:8,borderWidth:1,borderColor:C.primary}}>
              <Text style={{fontSize:20}}>{attachment.type==="pdf"?"📄":"🖼️"}</Text>
              <Text style={{flex:1,color:C.primary,fontWeight:"700",fontSize:12}} numberOfLines={1}>{attachment.name}</Text>
              <TouchableOpacity onPress={()=>setAttachment(null)}>
                <Text style={{color:C.red,fontWeight:"900",fontSize:16}}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{flexDirection:"row",gap:8,alignItems:"flex-end"}}>
            {/* Bouton photo */}
            <TouchableOpacity onPress={pickMsgImage}
              style={{width:40,height:40,borderRadius:10,backgroundColor:C.primary+"20",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:C.primary}}>
              <Text style={{fontSize:18}}>📷</Text>
            </TouchableOpacity>
            {/* Bouton PDF */}
            <TouchableOpacity onPress={pickMsgPdf}
              style={{width:40,height:40,borderRadius:10,backgroundColor:C.primary+"20",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:C.primary}}>
              <Text style={{fontSize:18}}>📄</Text>
            </TouchableOpacity>
            <TextInput value={newMsg} onChangeText={setNewMsg} placeholder={`Message à ${eq.label}…`} placeholderTextColor={C.gray} multiline
              style={{flex:1,backgroundColor:"#FFFFFF",borderWidth:2,borderColor:C.primary,borderRadius:14,padding:12,color:C.text,fontSize:14,maxHeight:100}}/>
            <TouchableOpacity onPress={send} disabled={uploading}
              style={{width:44,height:44,borderRadius:22,backgroundColor:uploading?"#999":C.primary,alignItems:"center",justifyContent:"center"}}>
              <Text style={{fontSize:20,color:"#FFFFFF"}}>{uploading?"⏳":"➤"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      </KeyboardAvoidingView>
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
    if(fresh!=null) setSondages(fresh);
    setRefreshing(false);
  }

  useEffect(()=>{
    refreshSondages();
    const interval=setInterval(refreshSondages, 300000); // 5 minutes
    return ()=>clearInterval(interval);
  },[currentEquipe]);
  const [reponseTexte, setReponseTexte]=useState({});
  const [reponseNombre, setReponseNombre]=useState({});
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];
  const sondageList=sondages.filter(s=>s.equipe===currentEquipe);
  const canCreate=getRole(user)==="coach";
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
              ))}}
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
                  <Text style={{color:C.text,fontSize:13}}>{val}</Text>
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
                style={{flex:1,backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,color:C.text,fontSize:14,minHeight:60}}
              />
              <TouchableOpacity onPress={()=>repondreTexteNombre(s,reponseTexte[s._id]||"")}
                style={{backgroundColor:C.primary,borderRadius:10,padding:12,alignItems:"center",justifyContent:"center"}}>
                <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>Envoyer</Text>
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
                style={{flex:1,backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,color:C.text,fontSize:14}}
              />
              <TouchableOpacity onPress={()=>repondreTexteNombre(s,reponseNombre[s._id]||"")}
                style={{backgroundColor:C.primary,borderRadius:10,padding:12}}>
                <Text style={{color:C.text,fontWeight:"700"}}>OK</Text>
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
                    {isChosen&&<Text style={{color:C.text,fontWeight:"900",fontSize:12}}>✓</Text>}
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
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:0}}>
        <GoldText style={{fontSize:28}}>Sondages</GoldText>
        <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
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
                <Text style={{color:C.text,fontWeight:"700",fontSize:15,flex:1,lineHeight:22}}>{s.question}</Text>
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
  const eq=EQUIPES.find(e=>e.id===currentEquipe)||EQUIPES[0];
  const teamPlayers=players.filter(p=>p.equipes&&p.equipes.includes(currentEquipe)).sort((a,b)=>(a.order??999)-(b.order??999));
  const evList=events.filter(e=>isValidEvent(e)&&e.equipe===currentEquipe);
  const totalMatchs=evList.filter(e=>e.type==="match").length;
  const totalEntrainements=evList.filter(e=>e.type==="entrainement").length;
  const totalTournois=evList.filter(e=>e.type==="tournoi").length;
  const [history, setHistory]=useState([]);
  const [loadingHistory, setLoadingHistory]=useState(true);

  useEffect(()=>{
    async function loadHistory() {
      setLoadingHistory(true);
      const h=await fbGet('presencesHistory');
      if(h!=null) setHistory(h);
      setLoadingHistory(false);
    }
    loadHistory();
  },[currentEquipe]);

  // Saison courante: du 01/07/YYYY au 30/06/YYYY+1
  const now=new Date();
  const seasonStart=now.getMonth()>=6
    ? `${now.getFullYear()}-07-01`
    : `${now.getFullYear()-1}-07-01`;
  const seasonEnd=now.getMonth()>=6
    ? `${now.getFullYear()+1}-06-30`
    : `${now.getFullYear()}-06-30`;

  // IDs des events qui existent encore dans Firestore pour cette équipe
  const validEventIds=new Set(
    events.filter(e=>e&&e._id&&e.equipe===currentEquipe).map(e=>e._id)
  );

  // IDs des entraînements uniquement (pour filtrer les stats)
  const entrainementIds=new Set(events.filter(e=>e.type==="entrainement"&&e.equipe===currentEquipe).map(e=>e._id));

  function getPlayerStats(p) {
    // Entrées de cette joueuse, dans la saison courante, pour l'équipe affichée
    const ph=history.filter(h=>
      h.playerId===p._id &&
      h.equipes && h.equipes.includes(currentEquipe) &&
      h.date>=seasonStart && h.date<=seasonEnd &&
      (h.valide===true || h.valide===undefined) &&
      entrainementIds.has(h.eventId)
    );
    const presences=ph.filter(h=>h.statut==="present").length;
    const absences=ph.filter(h=>h.statut==="absent").length;
    const retards=ph.filter(h=>h.statut==="retard").length;
    const total=presences+absences+retards;
    const taux=total>0?Math.round((presences/total)*100):null;
    return {presences,absences,retards,total,taux};
  }

  // Stats globales équipe (saison courante)
  // Dates des entraînements validés uniquement
  const totalAppels=[...new Set(
    history.filter(h=>
      h.equipes&&h.equipes.includes(currentEquipe)&&
      h.date>=seasonStart&&h.date<=seasonEnd&&
      (h.valide===true||h.valide===undefined)&&
      entrainementIds.has(h.eventId)
    ).map(h=>h.date)
  )].length;
  const todayISO=new Date().toISOString().slice(0,10);
  const todayEvs=events.filter(e=>e.equipe===currentEquipe&&e.date===todayISO);
  const todayHist=history.filter(h=>h.date===todayISO&&teamPlayers.find(p=>p._id===h.playerId));
  const hasTodaySession=todayEvs.length>0&&todayHist.length>0;
  const presentCount=hasTodaySession
    ?todayHist.filter(h=>h.statut==="present").length
    :null;
  const tauxJour=hasTodaySession&&teamPlayers.length>0?Math.round(((presentCount||0)/teamPlayers.length)*100):null;

  // Tri par taux de présence
  const sortedPlayers=[...teamPlayers].sort((a,b)=>{
    const sa=getPlayerStats(a);
    const sb=getPlayerStats(b);
    return (sb.taux||0)-(sa.taux||0);
  });

  return (
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:0}}>
        <GoldText style={{fontSize:28}}>Statistiques</GoldText>
        <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON {seasonStart.slice(0,4)}-{seasonEnd.slice(0,4)}</Text>
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
            <Text style={{color:C.text,fontWeight:"700"}}>{hasTodaySession?`${presentCount}/${teamPlayers.length} présentes`:"Aucune séance aujourd'hui"}</Text>
            {hasTodaySession&&<Text style={{color:(tauxJour||0)>=75?C.green:(tauxJour||0)>=50?C.gold:C.red,fontWeight:"900",fontSize:20}}>{tauxJour}%</Text>}
          </View>
          <View style={{backgroundColor:C.border,borderRadius:10,height:10,overflow:"hidden"}}>
            <View style={{width:hasTodaySession?`${tauxJour}%`:"0%",height:"100%",backgroundColor:tauxJour>=75?C.green:tauxJour>=50?C.gold:C.red,borderRadius:10}}/>
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
                  <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>{p.name}</Text>
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
              <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>{a.nom||a.email}</Text>
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
    { key:"canCreateSondages", label:"Créer des sondages" },
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
              <Text style={{color:C.text,fontWeight:"700",fontSize:14}}>{p.nom||p.email}</Text>
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
                {active&&<Text style={{color:C.text,fontWeight:"900",fontSize:13}}>✓</Text>}
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
function Autres({ lieux, setLieux, adversaires, setAdversaires, taches, setTaches, isCoach, user, onLogout, players, adjoints, setAdjoints, parentsList, setParentsList, convivialite, setConvivialite }) {
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
    <SafeAreaView style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{backgroundColor:"transparent",paddingHorizontal:18,paddingTop:16,paddingBottom:14,borderBottomWidth:0}}>
        <GoldText style={{fontSize:28}}>Autres</GoldText>
        <Text style={{color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:"600"}}>LESCAR HANDBALL · SAISON 2026-2027</Text>
      </View>
      <ScrollView style={{padding:14}} showsVerticalScrollIndicator={false}>

        {/* PROFIL */}
        <Card style={{flexDirection:"row",alignItems:"center",gap:12,marginBottom:14}}>
          <View style={{width:50,height:50,borderRadius:25,backgroundColor:role==="coach"?C.gold:role==="adjoint"?C.orange:C.primary,alignItems:"center",justifyContent:"center"}}>
            <Text style={{fontSize:24}}>{role==="coach"?"👑":role==="adjoint"?"🎽":"👪"}</Text>
          </View>
          <View style={{flex:1}}>
            <Text style={{color:C.text,fontWeight:"700",fontSize:15}}>{user.name}</Text>
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

          {/* CONVIVIALITÉ PARENTS */}
        {(()=>{
          const role=getRole(user);
          const canWrite=role==="coach"||role==="parent";
          const canDelete=role==="coach";
          const [convMsg, setConvMsg]=useState("");
          const [convRefreshing, setConvRefreshing]=useState(false);
          const convList=[...convivialite].sort((a,b)=>b._id.localeCompare(a._id));

          async function sendConv() {
            if(!convMsg.trim()||!canWrite) return;
            const id=Date.now().toString();
            const label=role==="coach"?"👑 "+user.name:"👪 "+user.name;
            const data={auteur:label,texte:convMsg.trim(),date:todayFmt(),heure:timeStr()};
            await fbSet('convivialite',id,data);
            setConvivialite(cs=>[...cs,{...data,_id:id}]);
            setConvMsg("");
          }
          async function delConv(m) {
            if(!canDelete) return;
            await fbDel('convivialite',m._id);
            setConvivialite(cs=>cs.filter(x=>x._id!==m._id));
          }
          async function refreshConv() {
            setConvRefreshing(true);
            const fresh=await fbGet('convivialite');
            setConvivialite(fresh);
            setConvRefreshing(false);
          }

          return (
            <Card style={{marginBottom:14}}>
              <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <GoldText style={{fontSize:15}}>Convivialité Parents</GoldText>
                <TouchableOpacity onPress={refreshConv}
                  style={{backgroundColor:C.card2,borderRadius:20,paddingHorizontal:10,paddingVertical:5,borderWidth:1,borderColor:C.border}}>
                  <Text style={{fontSize:14}}>{convRefreshing?"⏳":"🔄"}</Text>
                </TouchableOpacity>
              </View>
              <View style={{padding:10,borderRadius:10,backgroundColor:C.primary+"15",borderWidth:1,borderColor:C.primary,marginBottom:12}}>
                <Text style={{color:C.gray,fontSize:11,lineHeight:17}}>Espace dédié aux parents pour organiser des activités extra-sportives. Les coachs peuvent lire et modérer.</Text>
              </View>
              {convList.length===0?(
                <Text style={{color:C.gray,fontSize:13,marginBottom:12}}>Aucun message pour le moment.</Text>
              ):convList.map(msg=>(
                <View key={msg._id} style={{backgroundColor:C.card2,borderRadius:12,padding:12,marginBottom:8,borderLeftWidth:3,borderLeftColor:msg.auteur.includes("👑")?C.gold:C.blue}}>
                  <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <Text style={{color:msg.auteur.includes("👑")?C.gold:C.blue,fontWeight:"700",fontSize:12}}>{msg.auteur}</Text>
                    <View style={{flexDirection:"row",alignItems:"center",gap:8}}>
                      <Text style={{color:C.gray,fontSize:10}}>{msg.date} {msg.heure}</Text>
                      {canDelete&&<TouchableOpacity onPress={()=>delConv(msg)}><Text style={{color:C.red,fontSize:14}}>🗑️</Text></TouchableOpacity>}
                    </View>
                  </View>
                  <Text style={{color:C.text,fontSize:14,lineHeight:20}}>{msg.texte}</Text>
                </View>
              ))}
              {canWrite&&(
                <View style={{flexDirection:"row",gap:10,alignItems:"flex-end",marginTop:8}}>
                  <TextInput value={convMsg} onChangeText={setConvMsg}
                    placeholder="Votre message…" placeholderTextColor={C.gray} multiline
                    style={{flex:1,backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:12,padding:10,color:C.text,fontSize:14,maxHeight:80}}/>
                  <TouchableOpacity onPress={sendConv}
                    style={{width:42,height:42,borderRadius:21,backgroundColor:C.primary,alignItems:"center",justifyContent:"center"}}>
                    <Text style={{fontSize:18}}>➤</Text>
                  </TouchableOpacity>
                </View>
              )}
              {role==="adjoint"&&(
                <View style={{marginTop:8,padding:10,borderRadius:10,backgroundColor:C.card2,alignItems:"center"}}>
                  <Text style={{color:C.gray,fontSize:12}}>👁️ Lecture seule — espace réservé aux parents</Text>
                </View>
              )}
            </Card>
          );
        })()}

      {/* ANNUAIRE PARENTS */}
        {(isCoach||user.isAdjoint||can(user,'voirAnnuaire')||getRole(user)==='parent')&&<Card style={{marginBottom:14}}>
          <GoldText style={{fontSize:15,marginBottom:12}}>👪 Annuaire Parents</GoldText>
          {players.filter(p=>p.parent1||p.parent2).length===0?(
            <Text style={{color:C.gray,fontSize:13}}>Aucun parent enregistré.</Text>
          ):[...players].filter(p=>p.parent1||p.parent2).sort((a,b)=>(a.order??999)-(b.order??999)).map(p=>(
            <View key={p._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:C.card2,marginBottom:6}}>
              <Avatar initials={p.avatar||"??"} size={36}/>
              <View style={{flex:1}}>
                <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>{p.name}</Text>
                {p.parent1&&<Text style={{color:C.gray,fontSize:11,marginTop:2}}>👤 {p.parent1}{(isCoach||user.isAdjoint)&&p.emailParent1?" · "+p.emailParent1:""}</Text>}
                {p.parent2&&<Text style={{color:C.gray,fontSize:11}}>👤 {p.parent2}{(isCoach||user.isAdjoint)&&p.emailParent2?" · "+p.emailParent2:""}</Text>}
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
            {(()=>{
              const [showLieux, setShowLieux]=useState(false);
              return (
                <>
                  <TouchableOpacity onPress={()=>setShowLieux(!showLieux)}
                    style={{backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:showLieux?8:0}}>
                    <Text style={{color:C.gray,fontSize:14}}>Liste des lieux ({LIEUX_FIXES.length + lieux.filter(l=>!LIEUX_FIXES.find(f=>f.nom===l.nom)).length})</Text>
                    <Text style={{color:C.gold,fontSize:16}}>{showLieux?"▲":"▼"}</Text>
                  </TouchableOpacity>
                  {showLieux&&[...LIEUX_FIXES,...lieux.filter(l=>!LIEUX_FIXES.find(f=>f.nom===l.nom))].map(l=>(
                    <View key={l._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:l._id.startsWith("l")?C.card2+"80":C.card2,marginBottom:6,opacity:l._id.startsWith("l")?0.8:1}}>
                      <Text style={{fontSize:18}}>📍</Text>
                      <View style={{flex:1}}>
                        <Text style={{color:C.text,fontWeight:"700",fontSize:13}}>{l.nom}</Text>
                        {l.adresse&&<Text style={{color:C.gray,fontSize:11}}>{l.adresse}</Text>}
                      </View>
                      {l._id.startsWith("l")
                        ? <Text style={{color:C.gray,fontSize:10,fontStyle:"italic"}}>Figé</Text>
                        : <>
                          <TouchableOpacity onPress={()=>openEdit(l,"lieu")} style={{padding:5}}><Text>✏️</Text></TouchableOpacity>
                          <TouchableOpacity onPress={()=>delItem(l,"lieu")} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
                        </>
                      }
                    </View>
                  ))}
                </>
              );
            })()}
          </Card>
          <Card style={{marginBottom:14}}>
            <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <GoldText style={{fontSize:15}}>⚔️ Adversaires</GoldText>
              <Btn small onPress={()=>openAdd("adversaire")}>+ Ajouter</Btn>
            </View>
            {(()=>{
              const [showAdv, setShowAdv]=useState(false);
              const selAdv=adversaires[0];
              return (
                <>
                  <TouchableOpacity onPress={()=>setShowAdv(!showAdv)}
                    style={{backgroundColor:C.input,borderWidth:1.5,borderColor:C.border,borderRadius:10,padding:10,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:showAdv?8:0}}>
                    <Text style={{color:C.gray,fontSize:14}}>Liste des adversaires ({ADVERSAIRES_FIXES.length + adversaires.filter(a=>!ADVERSAIRES_FIXES.find(f=>f.nom===a.nom)).length})</Text>
                    <Text style={{color:C.gold,fontSize:16}}>{showAdv?"▲":"▼"}</Text>
                  </TouchableOpacity>
                  {showAdv&&[...ADVERSAIRES_FIXES,...adversaires.filter(a=>!ADVERSAIRES_FIXES.find(f=>f.nom===a.nom))].map(a=>(
                    <View key={a._id} style={{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:10,backgroundColor:a._id.startsWith("f")?C.card2+"80":C.card2,marginBottom:6,opacity:a._id.startsWith("f")?0.8:1}}>
                      <Text style={{fontSize:18}}>⚔️</Text>
                      <Text style={{color:C.text,fontWeight:"700",fontSize:13,flex:1}}>{a.nom}</Text>
                      {a._id.startsWith("f")
                        ? <Text style={{color:C.gray,fontSize:10,fontStyle:"italic"}}>Figé</Text>
                        : <>
                          <TouchableOpacity onPress={()=>openEdit(a,"adversaire")} style={{padding:5}}><Text>✏️</Text></TouchableOpacity>
                          <TouchableOpacity onPress={()=>delItem(a,"adversaire")} style={{padding:5}}><Text>🗑️</Text></TouchableOpacity>
                        </>
                      }
                    </View>
                  ))}
                </>
              );
            })()}
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
                <Text style={{color:t.fait?C.gray:C.text,flex:1,fontSize:13,textDecorationLine:t.fait?"line-through":"none"}}>{t.texte}</Text>
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

        {isCoach&&(
          <Card style={{marginBottom:40,alignItems:"center"}}>
            <GoldText style={{fontSize:15,marginBottom:4}}>📲 Partager l'application</GoldText>
            <Text style={{color:C.gray,fontSize:12,marginBottom:16,textAlign:"center"}}>Montrez ce QR code ou partagez le lien pour que les parents installent l'app</Text>
            <Image
              source={{uri:"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://snack.expo.dev/@steff64/-15f-2026-2027"}}
              style={{width:200,height:200,borderRadius:10,marginBottom:16}}
            />
            <TouchableOpacity onPress={()=>Linking.openURL("https://snack.expo.dev/@steff64/-15f-2026-2027")}
              style={{backgroundColor:C.primary+"20",borderRadius:10,padding:12,borderWidth:1.5,borderColor:C.primary,width:"100%",alignItems:"center",marginBottom:8}}>
              <Text style={{color:C.primaryLight,fontWeight:"700",fontSize:13}}>🔗 Ouvrir le lien</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{
              const url="https://snack.expo.dev/@steff64/-15f-2026-2027";
              if(Platform.OS==="ios"){
                Linking.openURL(`sms:&body=Télécharge Expo Go et ouvre ce lien pour accéder à l'app : ${url}`);
              } else {
                Linking.openURL(`sms:?body=Télécharge Expo Go et ouvre ce lien pour accéder à l'app : ${url}`);
              }
            }} style={{backgroundColor:C.green+"20",borderRadius:10,padding:12,borderWidth:1.5,borderColor:C.green,width:"100%",alignItems:"center"}}>
              <Text style={{color:C.green,fontWeight:"700",fontSize:13}}>💬 Envoyer par SMS</Text>
            </TouchableOpacity>
          </Card>
        )}
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
  const [lieux, setLieux]=useState(LIEUX_FIXES);
  const [adversaires, setAdversaires]=useState(ADVERSAIRES_FIXES);
  const [taches, setTaches]=useState([]);
  const [adjoints, setAdjoints]=useState([]);
  const [infos, setInfos]=useState([]);
  const [parentsList, setParentsList]=useState([]);
  const [convivialite, setConvivialite]=useState([]);
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
            } else {
              // Refresh token expiré → forcer reconnexion proprement
              await AsyncStorage.removeItem('lhb_user');
              setLoading(false);
              return;
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
    console.log("RELOAD called, token:", _fbToken?"OK":"VIDE");
    try {
      // Rafraîchir le token si nécessaire
      const saved=await AsyncStorage.getItem('lhb_user');
      if(saved) {
        const u=JSON.parse(saved);
        const age=Date.now()-(u.tokenTime||0);
        if(age>55*60*1000&&u.refreshToken) {
          const r=await fetch(`https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({grant_type:'refresh_token',refresh_token:u.refreshToken}),
          });
          const d=await r.json();
          if(d.id_token) {
            setFbToken(d.id_token);
            const updated={...u,token:d.id_token,tokenTime:Date.now()};
            await AsyncStorage.setItem('lhb_user',JSON.stringify(updated));
          }
        } else if(u.token) {
          setFbToken(u.token);
        }
      }
      const [p,e,m,s,l,a,t,adj,inf,ppList,conv]=await Promise.all([
        fbGet('players'),fbGet('events'),fbGet('messages'),fbGet('sondages'),
        fbGet('lieux'),fbGet('adversaires'),fbGet('taches'),fbGet('adjoints'),fbGet('infos'),fbGet('parentsPerms'),fbGet('convivialite'),
      ]);
      console.log('DATA loaded: players='+p.length+' events='+e.length);
      // Ne pas écraser si Firebase retourne vide (quota épuisé)
      if(p!=null&&p.length>0) setPlayers(p);
      if(e!=null&&e.length>0) setEvents(e.filter(isValidEvent));
      if(m!=null&&m.length>0) setMessages(m);
      if(s!=null&&s.length>0) setSondages(s);
      if(inf!=null&&inf.length>0) setInfos(inf);
      // Toujours fusionner avec données figées
      const allLieux=[...LIEUX_FIXES,...(l.length>0?l:[]).filter(x=>!LIEUX_FIXES.find(f=>f.nom===x.nom))];
      const allAdv=[...ADVERSAIRES_FIXES,...(a.length>0?a:[]).filter(x=>!ADVERSAIRES_FIXES.find(f=>f.nom===x.nom))];
      setLieux(allLieux);
      setAdversaires(allAdv);
      if(t.length>0)setTaches(t);
      setAdjoints(adj);setInfos(inf);setParentsList(ppList);
      if(conv.length>0)setConvivialite(conv);
    } catch(err) {}
  }

  // Rafraîchissement automatique toutes les 30 secondes
  useEffect(()=>{
    if(!user) return;

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
            } else {
              // Session expirée → reconnexion propre
              await AsyncStorage.removeItem('lhb_user');
              setUser(null);
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
        const [p,e,m,s,l,a,t,adj,inf,ppList,conv]=await Promise.all([
          fbGet('players'),fbGet('events'),fbGet('messages'),fbGet('sondages'),
          fbGet('lieux'),fbGet('adversaires'),fbGet('taches'),fbGet('adjoints'),fbGet('infos'),fbGet('parentsPerms'),fbGet('convivialite'),
        ]);
        const validEvents=(e!=null)?e.filter(isValidEvent):null;
        if(p!=null) setPlayers(p);
        if(validEvents!=null&&validEvents.length>0) setEvents(validEvents);
        if(m!=null) setMessages(m);
        if(s!=null) setSondages(s);
        setLieux(l.length>0?[...LIEUX_FIXES,...l.filter(x=>!LIEUX_FIXES.find(f=>f.nom===x.nom))]:LIEUX_FIXES);
        setAdversaires(a.length>0?[...ADVERSAIRES_FIXES,...a.filter(x=>!ADVERSAIRES_FIXES.find(f=>f.nom===x.nom))]:ADVERSAIRES_FIXES);
        setTaches(t.length>0?t:[{_id:"1",texte:"Préparer les maillots",fait:false}]);
        setAdjoints(adj);
        if(ppList.length>0) setParentsList(ppList);
        setConvivialite(conv);
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
    setPlayers([]);setEvents([]);setMessages([]);setSondages([]);setAdjoints([]);setInfos([]);setParentsList([]);setConvivialite([]);
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
    <>
    <StatusBar barStyle="light-content" backgroundColor="#3B0764" translucent={false}/>
    <LinearGradient
      colors={["#3B0764","#5B21B6","#7C3AED","#A78BFA","#EDE9FE","#FFFFFF"]}
      locations={[0,0.10,0.22,0.38,0.55,1]}
      style={{flex:1}}>
    <View style={{flex:1,backgroundColor:"transparent"}}>
      <View style={{flex:1}}>
        {tab==="dashboard"  && <Dashboard players={players} events={events} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user} infos={infos} setInfos={setInfos} reloadAll={reloadAll}/>}
        {tab==="players"    && <Players players={players} setPlayers={setPlayers} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} loading={loading} user={user}/>}
        {tab==="calendar"   && <CalendarView events={events} setEvents={setEvents} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user} taches={taches} adversaires={adversaires} lieux={lieux}/>}
        {tab==="presences"  && <Presences players={players} setPlayers={setPlayers} events={events} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user}/>}
        {tab==="messagerie" && <Messagerie messages={messages} setMessages={setMessages} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user}/>}
        {tab==="sondages"   && <Sondages sondages={sondages} setSondages={setSondages} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe} user={user}/>}
        {tab==="stats"      && <Statistiques players={players} events={events} currentEquipe={currentEquipe} onEquipeChange={setCurrentEquipe}/>}
        {tab==="autres"     && <Autres lieux={lieux} setLieux={setLieux} adversaires={adversaires} setAdversaires={setAdversaires} taches={taches} setTaches={setTaches} isCoach={isCoach} user={user} onLogout={handleLogout} players={players} adjoints={adjoints} setAdjoints={setAdjoints} parentsList={parentsList} setParentsList={setParentsList} convivialite={convivialite} setConvivialite={setConvivialite}/>}
      </View>
      <View style={{flexDirection:"row",backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.border,paddingBottom:Platform.OS==="android"?30:20,paddingTop:8}}>
        {TABS.map(t=>(
          <TouchableOpacity key={t.id} onPress={()=>setTab(t.id)} style={{flex:1,alignItems:"center",justifyContent:"center"}}>
            <Text style={{fontSize:16,opacity:tab===t.id?1:0.45}}>{t.icon}</Text>
            <Text style={{fontSize:7,fontWeight:"800",textTransform:"uppercase",color:tab===t.id?C.gold:C.gray,marginTop:2}}>{t.label}</Text>
            {tab===t.id&&<View style={{width:14,height:2,borderRadius:1,backgroundColor:C.gold,marginTop:2}}/>}
          </TouchableOpacity>
        ))}
      </View>
    </View>
    </LinearGradient>
    </>
  );
}