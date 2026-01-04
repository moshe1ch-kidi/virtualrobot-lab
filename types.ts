
import React from 'react';

export type CameraMode = 'HOME' | 'TOP' | 'FOLLOW';
export type EditorTool = 'NONE' | 'ROTATE' | 'PAN' | 'WALL' | 'RAMP' | 'COLOR_LINE' | 'PATH' | 'ROBOT_MOVE';
export type PathShape = 'STRAIGHT' | 'CORNER' | 'CURVED';

export interface CustomObject {
    id: string;
    type: EditorTool;
    shape?: PathShape;
    x: number;
    z: number;
    width: number;
    length: number;
    color?: string;
    height?: number;
    rotation?: number; 
    opacity?: number;
}

export interface DrawingSegment {
    start: [number, number, number];
    end: [number, number, number];
    color: string;
}

export interface RobotState {
  x: number;
  y: number; 
  z: number;
  rotation: number; // heading in degrees
  tilt: number; // pitch angle in degrees (forward/backward)
  roll: number; // roll angle in degrees (left/right)
  speed: number; 
  motorLeftSpeed: number; 
  motorRightSpeed: number; 
  ledLeftColor: string;
  ledRightColor: string;
  isMoving: boolean;
  isTouching: boolean;
  penDown: boolean;
  penColor: string;
  sensorX?: number; // Visual sensor projection X
  sensorZ?: number; // Visual sensor projection Z
}

export type RobotCommand = 
  | { type: 'MOVE'; distance: number }
  | { type: 'TURN'; angle: number }
  | { type: 'SET_LED'; side: 'left' | 'right' | 'both'; color: string }
  | { type: 'WAIT'; duration: number };

export interface SimulationContextType {
  runCode: (code: string) => void;
  resetSimulation: () => void;
  robotState: RobotState;
  setRobotState: React.Dispatch<React.SetStateAction<RobotState>>;
  isRunning: boolean;
}

declare global {
  // Removed duplicate JSX index signature as it's typically handled by React types
  // and causing "Duplicate index signature" errors in this environment.
  
  interface Window {
    showBlocklyNumpad: (
      initialValue: string | number, 
      onConfirm: (newValue: number) => void
    ) => void;

    showBlocklyColorPicker: (
      onPick: (newColor: string) => void
    ) => void;
  }
}
