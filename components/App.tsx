
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { RotateCcw, Code2, Ruler, Trophy, X, Flag, Save, FolderOpen, Download, Upload, ZoomIn, ZoomOut, Maximize, Home, Eye, Move, Hammer, Trash2, Mountain, Map as MapIcon, Square, Palette, Undo, Trash, Settings2, ChevronRight, ChevronLeft, CornerDownRight, MoveUpRight, GripHorizontal, PlusCircle, Check, AlertCircle, Hand, Copy, ExternalLink, Info, Bot, Terminal, LayoutList, Star, ShieldCheck, Settings, Key, BookOpen, Crown, PlayCircle, Edit3, EyeOff, RefreshCcw, FileUp, Zap, Gauge, Flame, LogOut, PenLine } from 'lucide-react';
import { Vector3, MOUSE, Color as ThreeColor } from 'three';
import BlocklyEditor, { BlocklyEditorHandle } from './BlocklyEditor';
import Robot3D from './Robot3D';
import SimulationEnvironment from './Environment';
import { RobotState, EditorTool, CameraMode, PathShape, CustomObject, DrawingSegment } from '../types';
import Numpad from './Numpad';
import SensorDashboard from './SensorDashboard';
import RulerTool from './RulerTool';
import ColorPickerTool from './ColorPickerTool';
import { ChallengeBuilderUI } from './ChallengeBuilderUI';
import { CHALLENGES, Challenge, SimulationHistory } from '../data/challenges';

const TICK_RATE = 16; 
const BASE_VELOCITY = 0.055; 
const BASE_TURN_SPEED = 0.13; 

const isColorMatch = (hex1: string, hex2: string, threshold = 0.4) => {
    try {
        const c1 = new ThreeColor(hex1);
        const c2 = new ThreeColor(hex2);
        // Fix: Replace non-existent Color.distanceTo with manual Euclidean distance calculation in RGB space.
        const dist = Math.sqrt(
            Math.pow(c1.r - c2.r, 2) + 
            Math.pow(c1.g - c2.g, 2) + 
            Math.pow(c1.b - c2.b, 2)
        );
        return dist < threshold;
    } catch (e) { return false; }
};

const calculateSensorData = (x: number, z: number, rotation: number, challengeId?: string, customObjects: CustomObject[] = []) => {
    const rad = (rotation * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const gyro = Math.round(((rotation % 360) + 360) % 360);

    // לוגיקת קירות פשוטה
    const checkHit = (px: number, pz: number) => {
        // גבולות זירה בסיסיים
        if (Math.abs(px) > 48 || Math.abs(pz) > 48) return true;
        // קירות אתגר
        if (challengeId === 'c10' && pz < -9.7 && pz > -10.3 && Math.abs(px) < 3) return true;
        // אובייקטים מותאמים
        for (const obj of customObjects) {
            if (obj.type === 'WALL') {
                const dx = px - obj.x; const dz = pz - obj.z;
                const cR = Math.cos(-(obj.rotation || 0)); const sR = Math.sin(-(obj.rotation || 0));
                const lx = dx * cR - dz * sR; const lz = dx * sR + dz * cR;
                if (Math.abs(lx) <= obj.width/2 && Math.abs(lz) <= obj.length/2) return true;
            }
        }
        return false;
    };

    // כיול לפי התיאור של המשתמש: הפגוש ב-1.5
    const bumperFrontZ = 1.5;
    
    // בדיקת התנגשות פיזית - 3 נקודות לאורך חזית הרובוט
    const checkPhysicalCollision = (dist: number) => {
        for (const offset of [-0.6, 0, 0.6]) {
            const wx = x + (offset * Math.cos(rad) + dist * Math.sin(rad));
            const wz = z + (-offset * Math.sin(rad) + dist * Math.cos(rad));
            if (checkHit(wx, wz)) return true;
        }
        return false;
    };

    const physicalHit = checkPhysicalCollision(bumperFrontZ);
    // חיישן מגע נלחץ קצת לפני העצירה הסופית
    const isTouching = checkPhysicalCollision(bumperFrontZ + 0.05);

    // חיישן מרחק - מתחיל ממרחק 1.5 (קצה חיישן המגע)
    let distance = 255;
    for (let d = 0; d < 40; d += 0.05) {
        const tx = x + sin * (bumperFrontZ + d);
        const tz = z + cos * (bumperFrontZ + d);
        if (checkHit(tx, tz)) {
            distance = Math.round(d * 10); // המרה לס"מ
            break;
        }
    }

    // אכיפה: אם אנחנו בנגיעה פיזית, המרחק הוא 0
    if (physicalHit) distance = 0;

    return { gyro, isTouching, physicalHit, distance, y: 0, tilt: 0, roll: 0, color: 'white', rawDecimalColor: 0xffffff };
};

const App: React.FC = () => {
    const [generatedCode, setGeneratedCode] = useState('');
    const [startBlockCount, setStartBlockCount] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const [robotState, setRobotState] = useState<RobotState>({ 
        x: 0, y: 0, z: 0, rotation: 180, tilt: 0, roll: 0, speed: 100, 
        motorLeftSpeed: 0, motorRightSpeed: 0, ledLeftColor: 'black', 
        ledRightColor: 'black', isMoving: false, isTouching: false, 
        penDown: false, penColor: '#000000' 
    });
    const robotRef = useRef<RobotState>(robotState);
    const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
    const [customObjects, setCustomObjects] = useState<CustomObject[]>([]);
    const [isEditorMode, setIsEditorMode] = useState(false);
    const [selectedTool, setSelectedTool] = useState<EditorTool>('NONE');
    const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
    const [showChallenges, setShowChallenges] = useState(false);
    const [challengeSuccess, setChallengeSuccess] = useState(false);
    
    const blocklyEditorRef = useRef<BlocklyEditorHandle>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const executionId = useRef(0);

    const handleRun = useCallback(async () => {
        if (isRunning) return;
        setIsRunning(true);
        setChallengeSuccess(false);
        const currentId = ++executionId.current;
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const robotProxy = {
            move: async (dist: number) => {
                const startX = robotRef.current.x;
                const startZ = robotRef.current.z;
                const target = Math.abs(dist) * 0.1;
                const dir = dist > 0 ? 1 : -1;
                while (true) {
                    if (controller.signal.aborted) throw new Error("Abort");
                    const moved = Math.sqrt(Math.pow(robotRef.current.x - startX, 2) + Math.pow(robotRef.current.z - startZ, 2));
                    if (moved >= target) break;
                    robotRef.current = { ...robotRef.current, motorLeftSpeed: 100 * dir, motorRightSpeed: 100 * dir };
                    await new Promise(r => setTimeout(r, TICK_RATE));
                    const sd = calculateSensorData(robotRef.current.x, robotRef.current.z, robotRef.current.rotation, activeChallenge?.id, customObjects);
                    if (sd.physicalHit && dir > 0) break;
                }
                robotRef.current = { ...robotRef.current, motorLeftSpeed: 0, motorRightSpeed: 0 };
            },
            turn: async (angle: number) => {
                const startRot = robotRef.current.rotation;
                const target = Math.abs(angle);
                const dir = angle > 0 ? 1 : -1;
                while (true) {
                    if (controller.signal.aborted) throw new Error("Abort");
                    const turned = Math.abs(robotRef.current.rotation - startRot);
                    if (turned >= target) break;
                    robotRef.current = { ...robotRef.current, motorLeftSpeed: -50 * dir, motorRightSpeed: 50 * dir };
                    await new Promise(r => setTimeout(r, TICK_RATE));
                }
                robotRef.current = { ...robotRef.current, motorLeftSpeed: 0, motorRightSpeed: 0 };
            },
            wait: (ms: number) => new Promise(r => setTimeout(r, ms)),
            getDistance: async () => calculateSensorData(robotRef.current.x, robotRef.current.z, robotRef.current.rotation, activeChallenge?.id, customObjects).distance,
            getTouch: async () => calculateSensorData(robotRef.current.x, robotRef.current.z, robotRef.current.rotation, activeChallenge?.id, customObjects).isTouching,
            stop: async () => { robotRef.current = { ...robotRef.current, motorLeftSpeed: 0, motorRightSpeed: 0 }; },
            setLed: (side: string, color: string) => {
                const updates: any = {};
                if (side === 'left' || side === 'both') updates.ledLeftColor = color;
                if (side === 'right' || side === 'both') updates.ledRightColor = color;
                robotRef.current = { ...robotRef.current, ...updates };
                setRobotState(prev => ({ ...prev, ...updates }));
            },
            updateVariable: () => {},
            onMessage: () => {},
            onObstacle: () => {},
            onColor: () => {},
            onDistance: () => {}
        };

        try {
            const func = new Function('robot', `return (async () => { ${generatedCode} })()`);
            await func(robotProxy);
        } catch (e) {
            console.error("Exec error", e);
        }
        setIsRunning(false);
    }, [generatedCode, isRunning, customObjects, activeChallenge]);

    const handleReset = useCallback(() => {
        abortControllerRef.current?.abort();
        executionId.current++;
        const start = activeChallenge?.startPosition || { x: 0, y: 0, z: 0 };
        const rot = activeChallenge?.startRotation ?? 180;
        const resetState = { 
            ...robotRef.current, x: start.x, y: 0, z: start.z, rotation: rot, 
            motorLeftSpeed: 0, motorRightSpeed: 0, isMoving: false, isTouching: false 
        };
        robotRef.current = resetState;
        setRobotState(resetState);
        setIsRunning(false);
        setChallengeSuccess(false);
    }, [activeChallenge]);

    useEffect(() => {
        let interval: any;
        if (isRunning) {
            interval = setInterval(() => {
                const curr = robotRef.current;
                const fv = ((curr.motorLeftSpeed + curr.motorRightSpeed) / 200) * BASE_VELOCITY;
                const rv = (curr.motorRightSpeed - curr.motorLeftSpeed) * BASE_TURN_SPEED * 0.5;
                
                const nextRot = curr.rotation + rv;
                const nx = curr.x + Math.sin(nextRot * Math.PI / 180) * fv;
                const nz = curr.z + Math.cos(nextRot * Math.PI / 180) * fv;
                
                const sd = calculateSensorData(nx, nz, nextRot, activeChallenge?.id, customObjects);
                
                const finalState = {
                    ...curr,
                    rotation: nextRot,
                    x: sd.physicalHit ? curr.x : nx,
                    z: sd.physicalHit ? curr.z : nz,
                    isTouching: sd.isTouching
                };
                
                robotRef.current = finalState;
                setRobotState(finalState);
                
                if (activeChallenge?.check(curr, finalState, { maxDistanceMoved: 0, touchedWall: sd.isTouching, detectedColors: [], totalRotation: 0 })) {
                    setChallengeSuccess(true);
                }
            }, TICK_RATE);
        }
        return () => clearInterval(interval);
    }, [isRunning, customObjects, activeChallenge]);

    const sensorReadings = useMemo(() => calculateSensorData(robotState.x, robotState.z, robotState.rotation, activeChallenge?.id, customObjects), [robotState, activeChallenge, customObjects]);

    return (
        <div className="flex flex-col h-screen bg-slate-900 text-white font-sans overflow-hidden" dir="ltr">
            <header className="h-14 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 z-20">
                <div className="flex items-center gap-3"><Code2 className="text-blue-400" /><h1 className="font-bold">RoboCode Lab</h1></div>
                <div className="flex items-center gap-2">
                    <button onClick={handleRun} disabled={isRunning} className={`p-2 rounded-lg ${isRunning ? 'bg-slate-700 text-slate-500' : 'bg-green-600 hover:bg-green-500 text-white shadow-lg active:scale-95'}`}><Flag size={20} /></button>
                    <button onClick={handleReset} className="p-2 bg-red-600 hover:bg-red-500 rounded-lg shadow-lg active:scale-95"><RotateCcw size={20} /></button>
                    <div className="w-px h-6 bg-slate-700 mx-2" />
                    <button onClick={() => setShowChallenges(true)} className="flex items-center gap-2 px-4 py-1.5 bg-yellow-500 text-slate-900 rounded-lg font-bold hover:bg-yellow-400 transition-all"><Trophy size={18} /> Challenges</button>
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                <div className="w-1/2 bg-white relative">
                    <BlocklyEditor 
                        ref={blocklyEditorRef} 
                        onCodeChange={(code, count) => { setGeneratedCode(code); setStartBlockCount(count); }} 
                        visibleVariables={new Set()} 
                        onToggleVariable={() => {}} 
                    />
                </div>
                <div className="w-1/2 relative bg-slate-950">
                    <SensorDashboard 
                        distance={sensorReadings.distance} 
                        isTouching={robotState.isTouching} 
                        gyroAngle={sensorReadings.gyro} 
                        detectedColor="white" 
                    />
                    <Canvas shadows camera={{ position: [8, 8, 8], fov: 45 }}>
                        <SimulationEnvironment challengeId={activeChallenge?.id} customObjects={customObjects} robotState={robotState} />
                        <Robot3D state={robotState} />
                        <OrbitControls makeDefault />
                    </Canvas>
                </div>
            </main>

            {showChallenges && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-8">
                    <div className="bg-slate-100 rounded-3xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl border-4 border-white" dir="rtl">
                        <div className="p-6 bg-white border-b flex justify-between items-center">
                            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Trophy className="text-yellow-500" /> בחר משימה</h2>
                            <button onClick={() => setShowChallenges(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><X size={24} /></button>
                        </div>
                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
                            {CHALLENGES.map(c => (
                                <button key={c.id} onClick={() => { setActiveChallenge(c); setCustomObjects(c.environmentObjects || []); handleReset(); setShowChallenges(false); }} className={`p-6 rounded-2xl border-4 text-right transition-all hover:scale-[1.02] ${activeChallenge?.id === c.id ? 'border-blue-500 bg-white shadow-xl' : 'border-white bg-white/60'}`}>
                                    <h3 className="text-xl font-bold text-slate-800 mb-2">{c.title}</h3>
                                    <p className="text-slate-500 text-sm">{c.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
