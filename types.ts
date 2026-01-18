export interface Action {
    id: number;
    title: string;
    discomfort: number;
    feeling: string;
    date: string;
    xp: number;
}

export interface WeeklyGoal {
    title: string;
    description: string;
    deadline: string;
    progress: number;
    target: number;
}

export interface AppState {
    // Data
    xp: number;
    level: number;
    streak: number;
    actions: Action[];
    weeklyGoal: WeeklyGoal;
    
    // UI State
    currentView: 'selection' | 'login' | 'mentor' | 'coachee';
    activeTab: 'dashboard' | 'add' | 'review';
    pinInput: string;
    pinError: boolean;
    newAction: {
        title: string;
        discomfort: number;
        feeling: string;
    };
    isEditingGoal: boolean;
    tempGoal: Partial<WeeklyGoal>;
    connectionStatus: 'connecting' | 'connected' | 'error' | 'saving';
    showConfetti: boolean;
}