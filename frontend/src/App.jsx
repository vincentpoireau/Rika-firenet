import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  query, 
  onSnapshot, 
  orderBy 
} from "firebase/firestore";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title, 
  Tooltip, 
  Legend, 
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { Thermometer, Target, Flame, RefreshCw, Clock, ShieldCheck, AlertCircle, CloudSun, Calendar, Search } from 'lucide-react';

// Enregistrement des composants Chart.js
ChartJS.register(
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement, 
  Title, 
  Tooltip, 
  Legend, 
  Filler
);

// Configuration Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD9qxoLbHD8d-ZiJnFgTVPZIbo1hgZ40Sw",
  authDomain: "rika-domo.firebaseapp.com",
  projectId: "rika-domo",
  storageBucket: "rika-domo.firebasestorage.app",
  messagingSenderId: "142029259326",
  appId: "1:142029259326:web:5199fd9385018644ad876f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export default function App() {
  const [logs, setLogs] = useState([]);
  const [weatherData, setWeatherData] = useState({});
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [timeRange, setTimeRange] = useState('24h'); 

  // Authentification Anonyme
  useEffect(() => {
    signInAnonymously(auth).catch(err => setError(`Erreur Auth : ${err.message}`));
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => u && setUser(u));
    return () => unsubscribeAuth();
  }, []);

  // Récupération des données Météo de Seynod via Open-Meteo
  // Latitude: 45.88, Longitude: 6.10 (Seynod)
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=45.88&longitude=6.10&hourly=temperature_2m&past_days=7');
        const data = await response.json();
        
        // On crée un dictionnaire de correspondance [ISO_Date_Hour] -> Température
        const mapping = {};
        if (data.hourly && data.hourly.time) {
          data.hourly.time.forEach((time, index) => {
            mapping[time] = data.hourly.temperature_2m[index];
          });
        }
        setWeatherData(mapping);
      } catch (err) {
        console.error("Erreur météo:", err);
      }
    };
    fetchWeather();
  }, []);

  // Récupération des données Firestore
  useEffect(() => {
    if (!user) return;
    const stoveRef = collection(db, 'stove');
    const q = query(stoveRef, orderBy('timestamp', 'asc'));

    const unsubscribeData = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          let dateObj = new Date();
          if (d.timestamp?.toDate) dateObj = d.timestamp.toDate();
          else if (d.timestamp?.seconds) dateObj = new Date(d.timestamp.seconds * 1000);
          return { 
            id: doc.id, ...d, date: dateObj,
            temperature: Number(d.temperature) || 0,
            thermostat: Number(d.thermostat) || 0,
            consumption: Number(d.consumption) || 0,
            is_burning: Boolean(d.is_burning)
          };
        });
        setLogs(data);
        setError(null);
      }
      setLoading(false);
    }, (err) => setError(`Erreur Firestore : ${err.message}`));

    return () => unsubscribeData();
  }, [user]);

  // Données filtrées et enrichies avec la météo
  const enrichedLogs = useMemo(() => {
    let base = logs;
    if (timeRange !== 'all' && logs.length > 0) {
      const now = new Date();
      let startTime = new Date();
      if (timeRange === '24h') startTime.setHours(now.getHours() - 24);
      else if (timeRange === '7d') startTime.setDate(now.getDate() - 7);
      else if (timeRange === '30d') startTime.setDate(now.getDate() - 30);
      base = logs.filter(log => log.date >= startTime);
    }

    return base.map(log => {
      // On arrondit à l'heure la plus proche pour matcher avec l'API météo
      const dateIso = log.date.toISOString().slice(0, 13) + ":00"; 
      return {
        ...log,
        ext_temp: weatherData[dateIso] ?? null
      };
    });
  }, [logs, timeRange, weatherData]);

  // Calcul des limites d'échelle dynamique
  const tempLimits = useMemo(() => {
    const dataToScale = enrichedLogs.length > 0 ? enrichedLogs : logs;
    if (dataToScale.length === 0) return { min: 0, max: 30 };
    
    const allValues = dataToScale.flatMap(l => {
        const vals = [l.temperature, l.thermostat];
        if (l.ext_temp !== null) vals.push(l.ext_temp);
        return vals;
    });
    
    return {
      min: Math.floor(Math.min(...allValues)) - 1,
      max: Math.ceil(Math.max(...allValues)) + 1
    };
  }, [enrichedLogs, logs]);

  // Agrégation des statistiques
  const stats = useMemo(() => {
    const daily = {};
    const weekly = {};
    const monthly = {};

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const d = log.date;
      const dayKey = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const weekKey = `S${Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7)} (${d.getFullYear()})`;
      const monthKey = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

      let runtimeHrs = 0;
      if (i > 0 && logs[i-1].is_burning) {
        const diffHrs = (log.date - logs[i-1].date) / (1000 * 60 * 60);
        if (diffHrs < 1.5) runtimeHrs = diffHrs; 
      }

      const process = (target, key) => {
        if (!target[key]) target[key] = { start: log.consumption, end: log.consumption, hrs: 0 };
        target[key].end = log.consumption;
        target[key].hrs += runtimeHrs;
      };

      process(daily, dayKey);
      process(weekly, weekKey);
      process(monthly, monthKey);
    }

    const format = (obj) => Object.entries(obj).map(([label, d]) => ({
      label, consumption: Math.max(0, d.end - d.start), runtime: d.hrs
    }));

    return { 
      daily: format(daily).slice(-14),
      weekly: format(weekly).slice(-8),
      monthly: format(monthly).slice(-12)
    };
  }, [logs]);

  const latest = enrichedLogs.length > 0 ? enrichedLogs[enrichedLogs.length - 1] : (logs.length > 0 ? logs[logs.length-1] : { temperature: 0, thermostat: 0, is_burning: false, date: new Date(), ext_temp: null });

  if (loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white gap-4">
        <RefreshCw className="animate-spin w-8 h-8 text-orange-500" />
        <p className="font-bold tracking-widest uppercase text-sm italic">Fusion des données météo de Seynod...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto">
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
            <div className="text-sm"><p className="font-bold">Erreur : {error}</p></div>
          </div>
        )}

        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight italic uppercase">Rika Firenet</h1>
            <p className="text-slate-500 flex items-center gap-2 text-sm font-semibold uppercase tracking-tighter">
               <ShieldCheck className="w-4 h-4 text-emerald-500" /> Seynod, France
            </p>
          </div>
          <div className="flex items-center gap-3 bg-white px-5 py-2.5 rounded-2xl border border-slate-200 shadow-sm">
             <div className={`w-3 h-3 rounded-full ${latest.is_burning ? 'bg-orange-500 animate-pulse' : 'bg-slate-300'}`}></div>
             <span className="text-sm font-bold text-slate-700 uppercase tracking-widest italic">
               {latest.is_burning ? 'Poêle actif' : 'En pause'}
             </span>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title="Intérieur" value={`${latest.temperature.toFixed(1)}°C`} icon={Thermometer} color="rose" />
          <StatCard title="Extérieur (Seynod)" value={latest.ext_temp !== null ? `${latest.ext_temp.toFixed(1)}°C` : '--'} icon={CloudSun} color="blue" />
          <StatCard title="Consigne" value={`${latest.thermostat.toFixed(1)}°C`} icon={Target} color="slate" />
          <StatCard title="Flamme" value={latest.is_burning ? "Oui" : "Non"} icon={Flame} color={latest.is_burning ? "orange" : "slate"} />
        </div>

        <div className="grid grid-cols-1 gap-8">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h3 className="text-sm font-black flex items-center gap-2 text-slate-700 uppercase italic tracking-tight">
                <Thermometer className="w-4 h-4 text-rose-500" /> Températures
              </h3>
              
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                {[
                  { label: '24h', value: '24h' },
                  { label: '7j', value: '7d' },
                  { label: '30j', value: '30d' },
                  { label: 'Tout', value: 'all' }
                ].map((opt) => (
                  <button 
                    key={opt.value}
                    onClick={() => setTimeRange(opt.value)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${timeRange === opt.value ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[450px]">
              <Line 
                data={{
                  labels: enrichedLogs.map(l => l.date.toLocaleString('fr-FR', { 
                    day: timeRange === '24h' ? undefined : '2-digit', 
                    month: timeRange === '24h' ? undefined : '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })),
                  datasets: [
                    { 
                      label: 'Intérieur', 
                      data: enrichedLogs.map(l => l.temperature), 
                      borderColor: '#f43f5e', 
                      borderWidth: 3,
                      backgroundColor: 'transparent',
                      tension: 0.4, 
                      pointRadius: 0,
                      yAxisID: 'y'
                    },
                    { 
                      label: 'Extérieur (Seynod)', 
                      data: enrichedLogs.map(l => l.ext_temp), 
                      borderColor: '#94a3b8', 
                      borderWidth: 2,
                      backgroundColor: 'rgba(148, 163, 184, 0.1)',
                      fill: true,
                      tension: 0.4, 
                      pointRadius: 0,
                      yAxisID: 'y'
                    },
                    { 
                      label: 'Consigne', 
                      data: enrichedLogs.map(l => l.thermostat), 
                      borderColor: '#3b82f6', 
                      borderDash: [5, 5], 
                      borderWidth: 1.5,
                      tension: 0, 
                      pointRadius: 0,
                      yAxisID: 'y'
                    },
                    {
                      label: 'Chauffe active',
                      data: enrichedLogs.map(l => l.is_burning ? tempLimits.max : tempLimits.min), 
                      backgroundColor: 'rgba(251, 146, 60, 0.08)',
                      fill: 'origin',
                      pointRadius: 0,
                      borderWidth: 0,
                      tension: 0,
                      stepped: true,
                      yAxisID: 'y'
                    }
                  ]
                }}
                options={{ 
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: { 
                    x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } },
                    y: { 
                      min: tempLimits.min, 
                      max: tempLimits.max,
                      grid: { color: '#f1f5f9' },
                      title: { display: true, text: 'Température (°C)', font: { weight: 'bold', size: 10 } }
                    }
                  },
                  plugins: {
                    legend: { position: 'top', align: 'end', labels: { usePointStyle: true, font: { size: 10, weight: 'bold' } } },
                    tooltip: { mode: 'index', intersect: false }
                  }
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatsGraph title="Consommation Journalière" data={stats.daily} />
            <StatsGraph title="Bilan Hebdomadaire" data={stats.weekly} />
            <StatsGraph title="Bilan Mensuel" data={stats.monthly} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsGraph({ title, data }) {
  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
      <h3 className="text-[11px] font-black mb-6 flex items-center gap-2 text-slate-600 uppercase italic tracking-tight">
        <Calendar className="w-3.5 h-3.5 text-orange-500" /> {title}
      </h3>
      <div className="h-[250px]">
        <Bar 
          data={{
            labels: data.map(d => d.label),
            datasets: [
              {
                label: 'Pellets (kg)',
                data: data.map(d => d.consumption),
                backgroundColor: 'rgba(251, 146, 60, 0.7)',
                borderRadius: 4,
                yAxisID: 'y',
              },
              {
                type: 'line',
                label: 'Fonctionnement (h)',
                data: data.map(d => d.runtime),
                borderColor: '#3b82f6',
                borderWidth: 2,
                tension: 0.3,
                yAxisID: 'y1',
              }
            ]
          }} 
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { position: 'left', grid: { display: false }, ticks: { font: { size: 9 } } },
              y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 9 } } },
              x: { grid: { display: false }, ticks: { font: { size: 9 } } }
            }
          }} 
        />
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }) {
  const colors = {
    rose: "bg-rose-50 text-rose-500",
    blue: "bg-blue-50 text-blue-500",
    orange: "bg-orange-50 text-orange-500",
    slate: "bg-slate-50 text-slate-500"
  };
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 flex items-center justify-between shadow-sm group">
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
        <p className="text-2xl font-black text-slate-800">{value}</p>
      </div>
      <div className={`p-3.5 rounded-2xl ${colors[color] || colors.slate}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
}