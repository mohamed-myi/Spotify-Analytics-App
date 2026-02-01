import { Role } from '@prisma/client';

export enum Permission {
    // Data access
    READ_OWN_DATA = 'read_own_data',
    WRITE_OWN_DATA = 'write_own_data',
    DELETE_OWN_DATA = 'delete_own_data',

    // Administrative
    READ_ALL_USERS = 'read_all_users',
    MANAGE_USERS = 'manage_users',

    // System
    TRIGGER_WORKERS = 'trigger_workers',
    VIEW_METRICS = 'view_metrics',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    DEMO: [Permission.READ_OWN_DATA],
    USER: [
        Permission.READ_OWN_DATA,
        Permission.WRITE_OWN_DATA,
        Permission.DELETE_OWN_DATA,
    ],
    ADMIN: Object.values(Permission), // All permissions
};

export function hasPermission(userRole: Role, permission: Permission): boolean {
    return ROLE_PERMISSIONS[userRole]?.includes(permission) ?? false;
}

export function getRoleFromUser(isDemo?: boolean): Role {
    // Helper function for backwards compatibility during migration
    if (isDemo) return 'DEMO';
    return 'USER';
}
