export interface RoleDimension {
  id: string;
  instructions: string;
  weight: number;
  /** ordered level descriptions, 2-10 entries per Jev's Score primitive */
  levels: string[];
}

export interface RoleMustHave {
  id: string;
  instructions: string;
}

export interface RoleThresholds {
  contact: number;
  reject: number;
  confidenceFloor: number;
}

export interface RoleRequirements {
  roleId: string;
  dimensions: RoleDimension[];
  mustHaves: RoleMustHave[];
  thresholds: RoleThresholds;
}
