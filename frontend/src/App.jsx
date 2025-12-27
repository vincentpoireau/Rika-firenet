import React, { useState, useEffect, useMemo } from 'react';
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
import { Thermometer, Target, Flame, RefreshCw, ShieldCheck, AlertCircle, CloudSun, Calendar } from 'lucide-react';

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


// Import des configurations depuis le fichier externe
import { firebaseConfig, appSettings } from './config';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export default function App() {
  const [logs, setLogs] = useState([]);
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

  // Récupération des données Firestore
  useEffect(() => {
    if (!user) return;
    // Utilisation du nom de collection défini dans la config
    const stoveRef = collection(db, appSettings.stoveCollection || 'stove');
    const q = query(stoveRef, orderBy('timestamp', 'asc'));

    const unsubscribeData = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          let dateObj = new Date();
          if (d.timestamp?.toDate) dateObj = d.timestamp.toDate();
          else if (d.timestamp?.seconds) dateObj = new Date(d.timestamp.seconds * 1000);
          
          return { 
            id: doc.id,
            date: dateObj,
            temperature: Number(d.temperature) || 0,
            thermostat: Number(d.thermostat) || 0,
            consumption_kg: Number(d.consumption_kg) || 0,
            consumption_h: Number(d.consumption_h) || 0,
            temperature_ext: d.temperature_ext !== undefined ? Number(d.temperature_ext) : null,
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

  // Filtrage temporel pour le graphique principal
  const filteredLogs = useMemo(() => {
    if (timeRange === 'all' || logs.length === 0) return logs;
    const now = new Date();
    let startTime = new Date();
    if (timeRange === '24h') startTime.setHours(now.getHours() - 24);
    else if (timeRange === '7d') startTime.setDate(now.getDate() - 7);
    else if (timeRange === '30d') startTime.setDate(now.getDate() - 30);
    return logs.filter(log => log.date >= startTime);
  }, [logs, timeRange]);

  // Limites d'échelle dynamique
  const tempLimits = useMemo(() => {
    if (filteredLogs.length === 0) return { min: 0, max: 30 };
    const allValues = filteredLogs.flatMap(l => {
        const vals = [l.temperature, l.thermostat];
        if (l.temperature_ext !== null) vals.push(l.temperature_ext);
        return vals;
    });
    return {
      min: Math.floor(Math.min(...allValues)) - 1,
      max: Math.ceil(Math.max(...allValues)) + 1
    };
  }, [filteredLogs]);

  // Agrégation simplifiée des statistiques (Utilise uniquement les compteurs cumulés)
  const stats = useMemo(() => {
    const daily = {};
    const weekly = {};
    const monthly = {};

    const updatePeriod = (target, key, log) => {
        const kgVal = log.consumption_kg;
        const hVal = log.consumption_h;

        if (!target[key]) {
            target[key] = { 
                kg_min: kgVal, kg_max: kgVal,
                h_min: hVal, h_max: hVal 
            };
        }
        target[key].kg_min = Math.min(target[key].kg_min, kgVal);
        target[key].kg_max = Math.max(target[key].kg_max, kgVal);
        target[key].h_min = Math.min(target[key].h_min, hVal);
        target[key].h_max = Math.max(target[key].h_max, hVal);
    };

    for (const log of logs) {
      const d = log.date;
      const dayKey = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const weekKey = `S${Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7)} (${d.getFullYear()})`;
      const monthKey = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

      updatePeriod(daily, dayKey, log);
      updatePeriod(weekly, weekKey, log);
      updatePeriod(monthly, monthKey, log);
    }

    const format = (obj) => Object.entries(obj).map(([label, d]) => ({
      label, 
      consumption_kg: Math.max(0, d.kg_max - d.kg_min), 
      consumption_h: Math.max(0, d.h_max - d.h_min)
    }));

    return { 
      daily: format(daily).slice(-14),
      weekly: format(weekly).slice(-8),
      monthly: format(monthly).slice(-12)
    };
  }, [logs]);

  const latest = filteredLogs.length > 0 ? filteredLogs[filteredLogs.length - 1] : { temperature: 0, thermostat: 0, is_burning: false, date: new Date(), temperature_ext: null };

  if (loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white gap-4">
        <RefreshCw className="animate-spin w-8 h-8 text-orange-500" />
        <p className="font-bold tracking-widest uppercase text-sm italic">Connexion {appSettings.title}...</p>
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
            {/* Utilisation du titre depuis la config */}
            <h1 className="text-3xl font-black text-slate-800 tracking-tight italic uppercase">{appSettings.title}</h1>
            <p className="text-slate-500 flex items-center gap-2 text-sm font-semibold uppercase tracking-tighter">
               {/* Utilisation de la localisation depuis la config */}
               <ShieldCheck className="w-4 h-4 text-emerald-500" /> {appSettings.location}
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
          <StatCard title="Extérieur" value={latest.temperature_ext !== null ? `${latest.temperature_ext.toFixed(1)}°C` : '--'} icon={CloudSun} color="blue" />
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
                  labels: filteredLogs.map(l => l.date.toLocaleString('fr-FR', { 
                    day: timeRange === '24h' ? undefined : '2-digit', 
                    month: timeRange === '24h' ? undefined : '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })),
                  datasets: [
                    { 
                      label: 'Intérieur', 
                      data: filteredLogs.map(l => l.temperature), 
                      borderColor: '#f43f5e', 
                      borderWidth: 3,
                      backgroundColor: 'transparent',
                      tension: 0.4, 
                      pointRadius: 0,
                      yAxisID: 'y'
                    },
                    { 
                      label: 'Extérieur', 
                      data: filteredLogs.map(l => l.temperature_ext), 
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
                      data: filteredLogs.map(l => l.thermostat), 
                      borderColor: '#3b82f6', 
                      borderDash: [5, 5], 
                      borderWidth: 1.5,
                      tension: 0, 
                      pointRadius: 0,
                      yAxisID: 'y'
                    },
                    {
                      label: 'Chauffe active',
                      data: filteredLogs.map(l => l.is_burning ? tempLimits.max : -50), 
                      backgroundColor: 'rgba(251, 146, 60, 0.08)',
                      fill: 'start',
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
                    tooltip: { 
                        mode: 'index', 
                        intersect: false,
                        filter: (item) => item.datasetIndex !== 3
                    }
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
                data: data.map(d => d.consumption_kg),
                backgroundColor: 'rgba(251, 146, 60, 0.7)',
                borderRadius: 4,
                yAxisID: 'y',
              },
              {
                type: 'line',
                label: 'Fonctionnement (h)',
                data: data.map(d => d.consumption_h),
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
            },
            plugins: {
                legend: { labels: { font: { size: 10, weight: 'bold' }, usePointStyle: true } }
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
      <div className={`p-3.5 rounded-2xl transition-transform group-hover:scale-105 ${colors[color] || colors.slate}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
}