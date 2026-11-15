import type {WorldSnapshot} from './RunStore';

const sameRow = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
        || Array.isArray(left) || Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(key => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
};

/** getWorld's transport timestamp changes even when the run does not. */
export function sameRunSnapshot(left: WorldSnapshot | undefined, right: WorldSnapshot | undefined): boolean {
    if (Object.is(left, right)) return true;
    if (!left || !right) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    const keys = Object.keys(a).filter(key => key !== 'time');
    if (keys.length !== Object.keys(b).filter(key => key !== 'time').length) return false;
    return keys.every(key => Object.hasOwn(b, key)
        && (key === 'data' ? sameRow(a[key], b[key]) : Object.is(a[key], b[key])));
}
