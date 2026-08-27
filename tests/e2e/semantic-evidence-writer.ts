import * as fs from 'fs';
import * as path from 'path';

export interface SemanticEvidence {
  uc: string;
  successConditionsMet: Record<string, boolean>;
  timestamp: string;
}

export function writeSemanticEvidence(uc: string, conditions: Record<string, boolean>) {
  const file = path.join(process.cwd(), 'uc-evidence.json');
  let data: SemanticEvidence[] = [];
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch { /* ignore */ }
  }
  // Remove existing evidence for this UC if any
  data = data.filter(d => d.uc !== uc);
  
  data.push({
    uc,
    successConditionsMet: conditions,
    timestamp: new Date().toISOString()
  });
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
