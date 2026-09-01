export interface LogEvent {
  id: string;
  timestamp: string;
  actor: string;
  operation: string;
  status: 'SUCCESS' | 'ERROR' | 'INFO' | 'WARN';
  message: string;
}
