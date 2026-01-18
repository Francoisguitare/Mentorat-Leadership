import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { 
    Zap, Lock, ArrowLeft, Delete, Award, Edit3, Check, 
    Trophy, Star, User, Flame, TrendingUp, Plus, Calendar,
    X
} from 'lucide-react';
import { AppState, Action, WeeklyGoal } from './types';

// --- CONFIGURATION FIREBASE ---
const getFirebaseConfig = () => {
    const w = window as any;
    if (w.__firebase_config) {
        try {
            return typeof w.__firebase_config === 'string' 
                ? JSON.parse(w.__firebase_config) 
                : w.__firebase_config;
        } catch (e) {
            console.error("Error parsing firebase config", e);
            return {};
        }
    }
    // Fallback/Dummy config
    return { apiKey: "DUMMY", authDomain: "dummy", projectId: "dummy" };
};

const appId = (window as any).__app_id || 'audacieuse-app-default';
const firebaseConfig = getFirebaseConfig();

// Initialize Firebase only if we have a config (or attempt to)
let auth: any;
let db: any;
try {
    // Only init if not dummy to avoid console errors
    if (firebaseConfig.apiKey !== "DUMMY") {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    }
} catch (e) {
    console.warn("Firebase init failed", e);
}

// --- CONSTANTS & HELPERS ---

const levelThresholds: Record<number, number> = { 1: 0, 2: 500, 3: 1000, 4: 2000, 5: 3500 };

const getLevelTitle = (lvl: number) => {
    if(lvl === 1) return "Novice";
    if(lvl === 2) return "Apprentie";
    if(lvl === 3) return "Aventurière";
    if(lvl === 4) return "Éclaireuse";
    if(lvl === 5) return "Légende";
    return "Héroïne";
};

const getFeelingEmoji = (feeling: string) => {
    const map: Record<string, string> = { 'proud': '🦁', 'relieved': '😌', 'neutral': '😐', 'stressed': '😰' };
    return map[feeling] || '😐';
};

const getDiscomfortClass = (val: number) => {
    if (val < 4) return 'bg-green-100 text-green-800';
    if (val < 8) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
};

const defaultState: AppState = {
    xp: 0,
    level: 1,
    streak: 0,
    actions: [],
    weeklyGoal: {
        title: "En attente du Mentor...",
        description: "L'objectif de la semaine sera défini bientôt ici.",
        deadline: "Dimanche",
        progress: 0,
        target: 1
    },
    currentView: 'selection', 
    activeTab: 'dashboard',
    pinInput: '',
    pinError: false,
    newAction: { title: '', discomfort: 5, feeling: 'neutral' },
    isEditingGoal: false,
    tempGoal: {},
    connectionStatus: 'connecting',
    showConfetti: false
};

// --- COMPONENTS ---

const StatusIndicator = ({ status }: { status: AppState['connectionStatus'] }) => {
    let colorClass = 'bg-yellow-400';
    let text = 'Connexion...';
    let pulse = '';

    if (status === 'connected') {
        colorClass = 'bg-green-500';
        text = 'Sauvegardé';
        pulse = '';
    } else if (status === 'saving') {
        colorClass = 'bg-yellow-400';
        text = 'Enregistrement...';
        pulse = 'animate-pulse';
    } else if (status === 'error') {
        colorClass = 'bg-red-500';
        text = 'Erreur réseau';
    }

    return (
        <div className="fixed top-2 right-2 z-50 flex items-center gap-2 bg-white/90 backdrop-blur px-2 py-1 rounded-full shadow-sm border border-slate-100 text-[10px] font-medium text-slate-500 pointer-events-none">
            <div className={`w-2 h-2 rounded-full ${colorClass} ${pulse}`}></div>
            {text}
        </div>
    );
};

export default function App() {
    const [state, setState] = useState<AppState>(defaultState);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- FIREBASE & LOCAL STORAGE LOGIC ---
    useEffect(() => {
        // Fallback LocalStorage si pas de config Firebase valide
        if (!auth || !db) {
            console.log("Mode LocalStorage activé (Firebase non configuré)");
            const localData = localStorage.getItem(`audacieuse_${appId}`);
            if (localData) {
                try {
                    const parsed = JSON.parse(localData);
                    setState(prev => ({
                        ...prev,
                        ...parsed,
                        currentView: prev.currentView,
                        activeTab: prev.activeTab,
                        connectionStatus: 'connected'
                    }));
                } catch (e) {
                    console.error("Erreur lecture locale", e);
                }
            } else {
                setState(prev => ({ ...prev, connectionStatus: 'connected' }));
            }
            return;
        }

        const init = async () => {
            try {
                await signInAnonymously(auth);
                const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mentorship_shared_v1', 'main');

                const unsubscribe = onSnapshot(docRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const remoteData = docSnap.data();
                        setState(prev => ({
                            ...prev,
                            ...remoteData,
                            currentView: prev.currentView,
                            activeTab: prev.activeTab,
                            connectionStatus: 'connected'
                        }));
                    } else {
                        saveToCloud(true);
                    }
                }, (error) => {
                    console.error("Erreur Sync:", error);
                    setState(prev => ({ ...prev, connectionStatus: 'error' }));
                });

                return () => unsubscribe();
            } catch (err) {
                console.error("Erreur Auth:", err);
                setState(prev => ({ ...prev, connectionStatus: 'error' }));
            }
        };

        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveToCloud = async (force = false, stateOverride?: Partial<AppState>) => {
        const currentState = stateOverride ? { ...state, ...stateOverride } : state;
        
        setState(prev => ({ ...prev, connectionStatus: 'saving' }));

        const dataToSave = {
            xp: currentState.xp,
            level: currentState.level,
            streak: currentState.streak,
            actions: currentState.actions,
            weeklyGoal: currentState.weeklyGoal
        };

        // Sauvegarde LocalStorage si pas de Firebase
        if (!auth || !db) {
             if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
             
             const doSave = () => {
                 localStorage.setItem(`audacieuse_${appId}`, JSON.stringify(dataToSave));
                 setState(prev => ({ ...prev, connectionStatus: 'connected' }));
             };

             if (force) doSave();
             else {
                 saveTimeoutRef.current = setTimeout(doSave, 1000);
             }
             return;
        }

        // Sauvegarde Firebase
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'mentorship_shared_v1', 'main');
        try {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

            if (force) {
                await setDoc(docRef, dataToSave, { merge: true });
                setState(prev => ({ ...prev, connectionStatus: 'connected' }));
            } else {
                saveTimeoutRef.current = setTimeout(async () => {
                    await setDoc(docRef, dataToSave, { merge: true });
                    setState(prev => ({ ...prev, connectionStatus: 'connected' }));
                }, 1000);
            }
        } catch (e) {
            console.error("Erreur sauvegarde", e);
            setState(prev => ({ ...prev, connectionStatus: 'error' }));
        }
    };

    // --- ACTIONS ---

    const setView = (view: AppState['currentView']) => {
        setState(prev => ({ ...prev, currentView: view }));
    };

    const setTab = (tab: AppState['activeTab']) => {
        setState(prev => ({ ...prev, activeTab: tab }));
    };

    const handlePin = (num: string) => {
        if (state.pinInput.length < 4) {
            const newVal = state.pinInput + num;
            setState(prev => ({ ...prev, pinInput: newVal }));
            
            if (newVal.length === 4) {
                if (newVal === '1234') {
                    setState(prev => ({ ...prev, currentView: 'mentor', pinInput: '' }));
                } else {
                    setState(prev => ({ ...prev, pinError: true }));
                    setTimeout(() => {
                        setState(prev => ({ ...prev, pinInput: '', pinError: false }));
                    }, 500);
                }
            }
        }
    };

    const clearPin = () => {
        setState(prev => ({ ...prev, pinInput: '', pinError: false }));
    };

    const toggleEditGoal = () => {
        setState(prev => {
            const isEditing = !prev.isEditingGoal;
            return {
                ...prev,
                isEditingGoal: isEditing,
                tempGoal: isEditing ? { ...prev.weeklyGoal } : {}
            };
        });
    };

    const updateTempGoal = (field: keyof WeeklyGoal, value: any) => {
        setState(prev => ({
            ...prev,
            tempGoal: { ...prev.tempGoal, [field]: value }
        }));
    };

    const saveGoal = () => {
        const newGoal = { ...state.weeklyGoal, ...state.tempGoal } as WeeklyGoal;
        const newState = { ...state, weeklyGoal: newGoal, isEditingGoal: false };
        setState(newState);
        saveToCloud(true, newState);
    };

    const updateNewAction = (field: string, value: any) => {
        setState(prev => ({
            ...prev,
            newAction: { ...prev.newAction, [field]: value }
        }));
    };

    const submitAction = () => {
        const discomfortPoints = parseInt(state.newAction.discomfort.toString()) * 10;
        const basePoints = 50;
        const totalPoints = basePoints + discomfortPoints;

        const newEntry: Action = {
            id: Date.now(),
            title: state.newAction.title,
            discomfort: parseInt(state.newAction.discomfort.toString()),
            feeling: state.newAction.feeling,
            date: new Date().toISOString().split('T')[0],
            xp: totalPoints
        };

        const newActions = [newEntry, ...state.actions];
        const newXp = state.xp + totalPoints;
        
        let nextLevel = 1;
        for (const [lvl, threshold] of Object.entries(levelThresholds)) {
            if (newXp >= threshold) nextLevel = parseInt(lvl);
        }

        const newState = {
            ...state,
            actions: newActions,
            xp: newXp,
            level: nextLevel,
            newAction: { title: '', discomfort: 5, feeling: 'neutral' },
            activeTab: 'dashboard' as const,
            showConfetti: true
        };

        setState(newState);
        saveToCloud(true, newState);
        
        setTimeout(() => setState(prev => ({ ...prev, showConfetti: false })), 2500);
    };

    const logout = () => {
        setState(prev => ({ ...prev, currentView: 'selection', pinInput: '' }));
    };

    // --- RENDERERS ---

    const renderSelection = () => (
        <>
            <StatusIndicator status={state.connectionStatus} />
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white relative overflow-hidden">
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url('https://www.transparenttextures.com/patterns/cubes.png')" }}></div>
                
                <div className="z-10 w-full max-w-md space-y-8 text-center animate-fade-in">
                    <div className="mb-8">
                        <h1 className="text-4xl font-bold mb-2 tracking-tight">L'Audacieuse</h1>
                        <p className="text-indigo-300">Plateforme de croissance & leadership</p>
                    </div>
                    
                    <div className="grid gap-4">
                        <button onClick={() => setView('coachee')} className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 p-6 rounded-2xl shadow-lg border border-white/10 text-left group w-full transition active:scale-95">
                            <div className="flex items-center gap-4">
                                <div className="bg-white/20 p-3 rounded-full"><Zap className="text-yellow-300 w-6 h-6" /></div>
                                <div>
                                    <h3 className="font-bold text-xl">Espace Mélissa</h3>
                                    <p className="text-sm text-indigo-100">Accéder à mon tableau de bord</p>
                                </div>
                            </div>
                        </button>

                        <button onClick={() => setView('login')} className="bg-slate-800 hover:bg-slate-700 p-6 rounded-2xl shadow-lg border border-slate-700 text-left group w-full transition active:scale-95">
                            <div className="flex items-center gap-4">
                                <div className="bg-slate-700 p-3 rounded-full"><Lock className="text-slate-400 w-6 h-6" /></div>
                                <div>
                                    <h3 className="font-bold text-xl text-slate-300">Espace Mentor</h3>
                                    <p className="text-sm text-slate-500">Accès réservé (Admin)</p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );

    const renderLogin = () => (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white relative">
            <button onClick={() => setView('selection')} className="absolute top-6 left-6 text-slate-400 p-2"><ArrowLeft /></button>
            <div className="w-full max-w-xs text-center animate-fade-in">
                <div className="mb-8">
                    <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Lock className="text-slate-400 w-8 h-8" />
                    </div>
                    <h2 className="text-xl font-bold">Code d'accès Mentor</h2>
                    <p className="text-slate-500 text-sm mt-2">Code par défaut: 1234</p>
                </div>

                <div className="flex justify-center gap-4 mb-8 h-4">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className={`w-4 h-4 rounded-full transition-all duration-200 ${state.pinInput.length > i ? 'bg-indigo-500' : 'bg-slate-700'} ${state.pinError ? 'bg-red-500' : ''}`}></div>
                    ))}
                </div>

                <div className="grid grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                        <button key={num} onClick={() => handlePin(num.toString())} className="h-16 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xl transition active:bg-slate-600">{num}</button>
                    ))}
                    <div className="col-start-2">
                            <button onClick={() => handlePin('0')} className="w-full h-16 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xl transition active:bg-slate-600">0</button>
                    </div>
                        <div className="col-start-3">
                            <button onClick={clearPin} className="w-full h-16 rounded-xl bg-slate-800/50 hover:bg-slate-700 flex items-center justify-center transition active:bg-slate-600"><Delete className="w-6 h-6" /></button>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderMentor = () => (
        <div className="bg-slate-50 min-h-screen font-sans text-slate-800 pb-20 animate-fade-in">
            <StatusIndicator status={state.connectionStatus} />
            <header className="bg-slate-800 text-white p-6 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <button onClick={() => setView('selection')} className="text-slate-400 hover:text-white flex items-center gap-2">
                        <ArrowLeft className="w-5 h-5" /> Retour
                    </button>
                    <span className="bg-slate-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-slate-300">Mode Admin</span>
                </div>
                <h1 className="text-2xl font-bold">Espace Mentor</h1>
                <p className="text-slate-400 text-sm">Gère les objectifs et suis la progression.</p>
            </header>

            <main className="p-4 space-y-6 max-w-2xl mx-auto">
                {/* KPI */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                        <span className="text-xs text-slate-500 font-bold uppercase">XP Totale</span>
                        <span className="text-2xl font-bold text-indigo-600 block">{state.xp}</span>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                        <span className="text-xs text-slate-500 font-bold uppercase">Actions</span>
                        <span className="text-2xl font-bold text-indigo-600 block">{state.actions.length}</span>
                    </div>
                </div>

                {/* Edition Objectif */}
                <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
                    <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-center">
                        <h2 className="font-bold text-indigo-900 flex items-center gap-2">
                            <Award className="w-4 h-4" /> Objectif Semaine
                        </h2>
                        <button onClick={toggleEditGoal} className="text-indigo-600 hover:text-indigo-800 p-2 rounded-full hover:bg-indigo-100">
                            {state.isEditingGoal ? <Check className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
                        </button>
                    </div>
                    
                    <div className="p-5">
                        {state.isEditingGoal ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Titre</label>
                                    <input 
                                        type="text" 
                                        value={state.tempGoal.title || ''} 
                                        onChange={(e) => updateTempGoal('title', e.target.value)} 
                                        className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Description</label>
                                    <textarea 
                                        value={state.tempGoal.description || ''}
                                        onChange={(e) => updateTempGoal('description', e.target.value)} 
                                        className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    ></textarea>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Cible (nb fois)</label>
                                    <input 
                                        type="number" 
                                        value={state.tempGoal.target || 0} 
                                        onChange={(e) => updateTempGoal('target', parseInt(e.target.value))} 
                                        className="w-full p-2 border border-slate-300 rounded-lg" 
                                    />
                                </div>
                                <button onClick={saveGoal} className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold shadow-md hover:bg-indigo-700">Enregistrer</button>
                            </div>
                        ) : (
                            <div>
                                <h3 className="text-xl font-bold text-slate-800 mb-2">{state.weeklyGoal.title}</h3>
                                <p className="text-slate-600 mb-4">{state.weeklyGoal.description}</p>
                                <div className="bg-slate-100 rounded-lg p-3 text-sm flex justify-between">
                                    <span className="text-slate-500">Progression :</span>
                                    <span className="font-bold text-slate-800">{state.weeklyGoal.progress} / {state.weeklyGoal.target}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Historique */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                    <h2 className="font-bold text-slate-800 mb-4">Historique des Audaces</h2>
                    <div className="space-y-4">
                        {state.actions.length === 0 ? (
                            <div className="text-center text-slate-400 py-4 italic">
                                Aucune action pour le moment.<br/>Le journal est vierge.
                            </div>
                        ) : (
                            state.actions.map(action => (
                                <div key={action.id} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-sm">{action.title}</span>
                                        <span className="text-xs text-slate-400">{action.date}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600">Inconfort: {action.discomfort}/10</span>
                                        <span className="text-indigo-600 font-bold">+{action.xp} XP</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </main>
        </div>
    );

    const renderCoachee = () => {
        const nextLvlXp = levelThresholds[state.level + 1] || 10000;
        const currentLvlXp = levelThresholds[state.level];
        const progressPercent = Math.min(100, ((state.xp - currentLvlXp) / (nextLvlXp - currentLvlXp)) * 100);

        const renderCoacheeContent = () => {
            if (state.activeTab === 'dashboard') {
                return (
                    <>
                        {/* Objectif Hebdo */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-50 rounded-bl-full -mr-4 -mt-4"></div>
                            <div className="relative z-10">
                                <div className="flex justify-between items-center mb-3">
                                    <h2 className="text-xs uppercase tracking-wider font-bold text-slate-400 flex items-center gap-2">
                                        <Award className="w-4 h-4" /> Mission Hebdo
                                    </h2>
                                    <span className="text-xs bg-purple-100 text-purple-700 font-bold px-2 py-1 rounded">
                                        {state.weeklyGoal.progress}/{state.weeklyGoal.target} complété
                                    </span>
                                </div>
                                <h3 className="text-xl font-bold text-slate-800 mb-1">{state.weeklyGoal.title}</h3>
                                <p className="text-slate-600 text-sm mb-4">{state.weeklyGoal.description}</p>
                                
                                <div className="flex gap-2">
                                    {Array.from({length: state.weeklyGoal.target}).map((_, i) => (
                                        <div key={i} className={`h-2 flex-1 rounded-full ${i < state.weeklyGoal.progress ? 'bg-purple-500' : 'bg-slate-200'}`}></div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Journal */}
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="font-bold text-lg text-slate-800">Journal de bord</h2>
                            </div>
                            <div className="space-y-3">
                                {state.actions.length === 0 ? (
                                    <div className="text-center text-slate-400 py-6 bg-white rounded-xl border border-dashed border-slate-200">
                                        <p className="text-sm">Ton aventure commence ici !<br/>Appuie sur + pour ajouter ton premier exploit.</p>
                                    </div>
                                ) : (
                                    state.actions.slice(0, 3).map(action => (
                                        <div key={action.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
                                            <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-inner flex-shrink-0">
                                                {getFeelingEmoji(action.feeling)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-semibold text-slate-800 leading-tight truncate">{action.title}</h4>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-slate-400 whitespace-nowrap">{new Date(action.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getDiscomfortClass(action.discomfort)}`}>Inc. {action.discomfort}</span>
                                                </div>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <span className="block font-bold text-indigo-600">+{action.xp}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Labo */}
                        <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden">
                            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url('https://www.transparenttextures.com/patterns/cubes.png')" }}></div>
                            <div className="relative z-10">
                                <h2 className="font-bold text-lg mb-2 flex items-center gap-2">
                                    <Zap className="text-yellow-400 w-5 h-5" /> Le Labo à Victoires
                                </h2>
                                <p className="text-indigo-200 text-sm mb-4">Espace pour noter les moments où tu as osé.</p>
                                <button onClick={() => setTab('add')} className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2">
                                    <Plus className="w-4 h-4" /> Ajouter une audace
                                </button>
                            </div>
                        </div>
                    </>
                );
            } else if (state.activeTab === 'add') {
                return (
                    <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100 animate-fade-in">
                        <h2 className="text-xl font-bold mb-6 text-center">Nouvelle Audace</h2>
                        
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Quelle action ?</label>
                                <input 
                                    type="text" 
                                    value={state.newAction.title} 
                                    onChange={(e) => updateNewAction('title', e.target.value)} 
                                    placeholder="Ex: J'ai posé une question..." 
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" 
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-3 flex justify-between">
                                    <span>Niveau d'inconfort</span>
                                    <span className={`font-bold px-2 rounded ${getDiscomfortClass(state.newAction.discomfort)}`}>{state.newAction.discomfort}/10</span>
                                </label>
                                <input 
                                    type="range" 
                                    min="1" 
                                    max="10" 
                                    value={state.newAction.discomfort} 
                                    onChange={(e) => updateNewAction('discomfort', e.target.value)} 
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" 
                                />
                                <div className="flex justify-between text-xs text-slate-400 mt-1">
                                    <span>Facile</span>
                                    <span>Terrifiant</span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-3">Ton sentiment ?</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { val: 'proud', label: 'Fière', emoji: '🦁' },
                                        { val: 'relieved', label: 'Soulagée', emoji: '😌' },
                                        { val: 'neutral', label: 'Neutre', emoji: '😐' },
                                        { val: 'stressed', label: 'Stressée', emoji: '😰' }
                                    ].map(opt => (
                                        <button 
                                            key={opt.val} 
                                            onClick={() => updateNewAction('feeling', opt.val)} 
                                            className={`flex flex-col items-center justify-center p-2 rounded-xl border transition ${state.newAction.feeling === opt.val ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'bg-white border-slate-200'}`}
                                        >
                                            <span className="text-2xl mb-1">{opt.emoji}</span>
                                            <span className="text-[10px] font-medium text-slate-600">{opt.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button onClick={submitAction} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition active:scale-95">
                                Valider (+XP)
                            </button>
                            
                            <button onClick={() => setTab('dashboard')} className="w-full text-slate-500 py-2 text-sm">Annuler</button>
                        </div>
                    </div>
                );
            } else if (state.activeTab === 'review') {
                return (
                    <div className="bg-white rounded-2xl shadow-sm p-6 text-center animate-fade-in">
                        <Trophy className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
                        <h2 className="text-xl font-bold mb-2">Bilan Hebdo</h2>
                        <p className="text-slate-600 text-sm mb-6">Note ton audace globale, indépendamment des résultats.</p>
                        
                        <div className="flex justify-center gap-1 mb-8">
                            {[1,2,3,4,5].map((i) => <Star key={i} className="w-8 h-8 text-yellow-400 fill-yellow-400" />)}
                        </div>

                        <div className="bg-indigo-50 p-4 rounded-xl mb-6">
                            <h3 className="font-bold text-indigo-900 text-sm mb-2">Statistiques</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-3 rounded-lg shadow-sm">
                                    <span className="block text-2xl font-bold text-slate-800">{state.actions.length}</span>
                                    <span className="text-[10px] uppercase text-slate-400 font-bold">Actions</span>
                                </div>
                                <div className="bg-white p-3 rounded-lg shadow-sm">
                                    <span className="block text-2xl font-bold text-slate-800">
                                        {(state.actions.reduce((acc, curr) => acc + curr.discomfort, 0) / (state.actions.length || 1)).toFixed(1)}
                                    </span>
                                    <span className="text-[10px] uppercase text-slate-400 font-bold">Moy. Inconfort</span>
                                </div>
                            </div>
                        </div>

                        <button className="bg-slate-900 text-white w-full py-3 rounded-xl font-medium">Archiver la semaine</button>
                    </div>
                );
            }
        };

        return (
            <div className="bg-slate-50 font-sans text-slate-800 pb-24 relative overflow-x-hidden animate-fade-in min-h-screen">
                <StatusIndicator status={state.connectionStatus} />
                
                {/* Header */}
                <header className="bg-indigo-600 text-white p-6 rounded-b-3xl shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full -mr-10 -mt-10"></div>
                    <button onClick={logout} className="absolute top-4 right-4 z-20 opacity-50 hover:opacity-100 p-2"><User className="w-5 h-5" /></button>
                    
                    <div className="flex justify-between items-start mb-4 relative z-10">
                        <div>
                            <h1 className="text-xl font-bold opacity-90">Bonjour, Héroïne !</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-3xl font-bold text-yellow-300">Niveau {state.level}</span>
                                <span className="text-indigo-200 text-sm font-medium border border-indigo-400 px-2 py-0.5 rounded-full">{getLevelTitle(state.level)}</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-end mr-8">
                            <div className="flex items-center gap-1 bg-indigo-800 bg-opacity-50 px-3 py-1 rounded-full border border-indigo-500">
                                <Flame className="text-orange-400 w-4 h-4 fill-orange-400" />
                                <span className="font-bold text-orange-100 text-sm">{state.streak} j</span>
                            </div>
                        </div>
                    </div>

                    {/* Barre XP */}
                    <div className="relative z-10">
                        <div className="flex justify-between text-xs mb-1 text-indigo-200">
                            <span>XP: {state.xp}</span>
                            <span>Prochain: {nextLvlXp}</span>
                        </div>
                        <div className="w-full bg-indigo-900 rounded-full h-3 overflow-hidden shadow-inner">
                            <div className="bg-gradient-to-r from-yellow-400 to-yellow-200 h-full rounded-full transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
                        </div>
                    </div>
                </header>

                <main className="p-4 space-y-6 max-w-md mx-auto">
                    {renderCoacheeContent()}
                </main>

                {/* Navigation Bas */}
                <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-between items-center z-40 pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <button onClick={() => setTab('dashboard')} className={`flex flex-col items-center gap-1 ${state.activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-400'}`}>
                        <TrendingUp className="w-6 h-6" />
                        <span className="text-[10px] font-medium">Accueil</span>
                    </button>
                    
                    <button onClick={() => setTab('add')} className="bg-indigo-600 text-white rounded-full p-4 shadow-lg shadow-indigo-200 -mt-8 border-4 border-slate-50 transition active:scale-95">
                        <Plus className="w-6 h-6 stroke-[3]" />
                    </button>
                    
                    <button onClick={() => setTab('review')} className={`flex flex-col items-center gap-1 ${state.activeTab === 'review' ? 'text-indigo-600' : 'text-slate-400'}`}>
                        <Calendar className="w-6 h-6" />
                        <span className="text-[10px] font-medium">Bilan</span>
                    </button>
                </nav>
            </div>
        );
    };

    return (
        <>
            {state.showConfetti && (
                <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50 bg-black/20 backdrop-blur-[1px]">
                    <div className="bg-white p-8 rounded-3xl shadow-2xl animate-bounce text-center">
                        <span className="text-6xl block mb-2">🎉</span>
                        <h2 className="text-2xl font-bold text-indigo-600">Super !</h2>
                        <p className="text-slate-600">+XP gagnés</p>
                    </div>
                </div>
            )}

            {state.currentView === 'selection' && renderSelection()}
            {state.currentView === 'login' && renderLogin()}
            {state.currentView === 'mentor' && renderMentor()}
            {state.currentView === 'coachee' && renderCoachee()}
        </>
    );
}