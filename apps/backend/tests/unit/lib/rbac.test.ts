import { Permission, hasPermission, ROLE_PERMISSIONS } from '@/lib/rbac';
import { Role } from '@prisma/client';

describe('RBAC System', () => {
    describe('Role Permissions', () => {
        it('DEMO role has only READ_OWN_DATA permission', () => {
            const demoPerms = ROLE_PERMISSIONS['DEMO'];

            expect(demoPerms).toContain(Permission.READ_OWN_DATA);
            expect(demoPerms).toHaveLength(1);
        });

        it('USER role has read and write permissions', () => {
            const userPerms = ROLE_PERMISSIONS['USER'];

            expect(userPerms).toContain(Permission.READ_OWN_DATA);
            expect(userPerms).toContain(Permission.WRITE_OWN_DATA);
            expect(userPerms).toContain(Permission.DELETE_OWN_DATA);
            expect(userPerms).not.toContain(Permission.READ_ALL_USERS);
            expect(userPerms).not.toContain(Permission.WRITE_ALL_DATA);
            expect(userPerms).not.toContain(Permission.DELETE_ALL_DATA);
            expect(userPerms).not.toContain(Permission.MANAGE_USERS);
        });

        it('ADMIN role has all permissions', () => {
            const adminPerms = ROLE_PERMISSIONS['ADMIN'];
            const allPermissions = Object.values(Permission);

            expect(adminPerms).toHaveLength(allPermissions.length);
            allPermissions.forEach(perm => {
                expect(adminPerms).toContain(perm);
            });
        });
    });

    describe('hasPermission', () => {
        it('returns true when user has permission', () => {
            expect(hasPermission('USER', Permission.READ_OWN_DATA)).toBe(true);
            expect(hasPermission('USER', Permission.WRITE_OWN_DATA)).toBe(true);
            expect(hasPermission('ADMIN', Permission.MANAGE_USERS)).toBe(true);
        });

        it('returns false when user lacks permission', () => {
            expect(hasPermission('DEMO', Permission.WRITE_OWN_DATA)).toBe(false);
            expect(hasPermission('USER', Permission.READ_ALL_USERS)).toBe(false);
            expect(hasPermission('DEMO', Permission.MANAGE_USERS)).toBe(false);
        });

        it('handles invalid role gracefully', () => {
            expect(hasPermission('INVALID_ROLE' as Role, Permission.READ_OWN_DATA)).toBe(false);
        });

        it('ADMIN can do everything', () => {
            const allPermissions = Object.values(Permission);

            allPermissions.forEach(permission => {
                expect(hasPermission('ADMIN', permission)).toBe(true);
            });
        });

        it('DEMO can only read own data', () => {
            expect(hasPermission('DEMO', Permission.READ_OWN_DATA)).toBe(true);
            expect(hasPermission('DEMO', Permission.WRITE_OWN_DATA)).toBe(false);
            expect(hasPermission('DEMO', Permission.DELETE_OWN_DATA)).toBe(false);
            expect(hasPermission('DEMO', Permission.READ_ALL_USERS)).toBe(false);
            expect(hasPermission('DEMO', Permission.WRITE_ALL_DATA)).toBe(false);
            expect(hasPermission('DEMO', Permission.DELETE_ALL_DATA)).toBe(false);
            expect(hasPermission('DEMO', Permission.MANAGE_USERS)).toBe(false);
        });
    });

    describe('Permission Hierarchy', () => {
        it('DEMO has fewest permissions', () => {
            expect(ROLE_PERMISSIONS['DEMO'].length).toBeLessThan(ROLE_PERMISSIONS['USER'].length);
            expect(ROLE_PERMISSIONS['DEMO'].length).toBeLessThan(ROLE_PERMISSIONS['ADMIN'].length);
        });

        it('USER has more permissions than DEMO', () => {
            expect(ROLE_PERMISSIONS['USER'].length).toBeGreaterThan(ROLE_PERMISSIONS['DEMO'].length);
            expect(ROLE_PERMISSIONS['USER'].length).toBeLessThan(ROLE_PERMISSIONS['ADMIN'].length);
        });

        it('ADMIN has most permissions', () => {
            expect(ROLE_PERMISSIONS['ADMIN'].length).toBeGreaterThan(ROLE_PERMISSIONS['USER'].length);
            expect(ROLE_PERMISSIONS['ADMIN'].length).toBeGreaterThan(ROLE_PERMISSIONS['DEMO'].length);
        });
    });
});
