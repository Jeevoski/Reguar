import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { Communication, FleetItem, RealtimeRulPoint, SensorConnection, ServiceAlert, SourceState, TelemetryPoint } from '../types/domain';

const socketEndpoint = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export function useRealtime(handlers: {
  onFleetUpdate?: (payload: FleetItem[]) => void;
  onTelemetryUpdate?: (payload: { inverter_id: string; point: TelemetryPoint }) => void;
  onSourceUpdate?: (payload: SourceState) => void;
  onAlert?: (payload: { inverter_id: string; message: string; level: string; ts: number }) => void;
  onServiceAlertNew?: (payload: ServiceAlert) => void;
  onServiceAlertAck?: (payload: { id: number }) => void;
  onCommunicationNew?: (payload: Communication) => void;
  onCommunicationAck?: (payload: { id: number }) => void;
  onSensorStatus?: (payload: SensorConnection) => void;
  onRulUpdate?: (payload: RealtimeRulPoint) => void;
}) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const socket = io(socketEndpoint, { transports: ['websocket', 'polling'] });

    socket.on('fleet:update', (payload: FleetItem[]) => handlersRef.current.onFleetUpdate?.(payload));
    socket.on('telemetry:update', (payload: { inverter_id: string; point: TelemetryPoint }) =>
      handlersRef.current.onTelemetryUpdate?.(payload)
    );
    socket.on('source:update', (payload: SourceState) => handlersRef.current.onSourceUpdate?.(payload));
    socket.on('alert', (payload: { inverter_id: string; message: string; level: string; ts: number }) =>
      handlersRef.current.onAlert?.(payload)
    );
    socket.on('service-alert:new', (payload: ServiceAlert) => handlersRef.current.onServiceAlertNew?.(payload));
    socket.on('service-alert:ack', (payload: { id: number }) => handlersRef.current.onServiceAlertAck?.(payload));
    socket.on('communication:new', (payload: Communication) => handlersRef.current.onCommunicationNew?.(payload));
    socket.on('communication:ack', (payload: { id: number }) => handlersRef.current.onCommunicationAck?.(payload));
    socket.on('sensor:status', (payload: SensorConnection) => handlersRef.current.onSensorStatus?.(payload));
    socket.on('rul:update', (payload: RealtimeRulPoint) => handlersRef.current.onRulUpdate?.(payload));

    return () => {
      socket.disconnect();
    };
  }, []);
}
