// Type model for LeetCode problem signatures (canonical LeetCode type tokens).
// Examples: `integer`, `integer[]`, `integer[][]`, `string`, `boolean`, `double`,
// `string[]`, `ListNode`, `TreeNode`, `NestedInteger`.

export type Shape =
  | { kind: 'scalar'; base: 'int' | 'double' | 'bool' | 'string' }
  | { kind: 'list'; item: Shape }
  | { kind: 'linkedlist' }
  | { kind: 'tree' }
  | { kind: 'nestedinteger' }

export function parseType(type: string): Shape {
  const t = (type || 'integer').replace(/\s+/g, '')
  // NestedInteger (for flatten list problems)
  if (/^nestedinteger$/i.test(t)) return { kind: 'nestedinteger' }
  // ListNode / TreeNode
  if (/^listnode$/i.test(t)) return { kind: 'linkedlist' }
  if (/^treenode$/i.test(t)) return { kind: 'tree' }
  if (/^char$/i.test(t)) return { kind: 'scalar', base: 'string' }

  // detect trailing [] count
  const dims = (t.match(/\[\]/g) || []).length
  const base = t.replace(/\[\]/g, '')
  let shape: Shape
  switch (base) {
    case 'integer':
    case 'int':
    case 'long':
    case 'number':
      shape = { kind: 'scalar', base: 'int' }
      break
    case 'double':
    case 'float':
      shape = { kind: 'scalar', base: 'double' }
      break
    case 'boolean':
    case 'bool':
      shape = { kind: 'scalar', base: 'bool' }
      break
    case 'string':
    case 'char':
      shape = { kind: 'scalar', base: 'string' }
      break
    case 'list':
      shape = { kind: 'scalar', base: 'string' }
      break
    default:
      shape = { kind: 'scalar', base: 'int' } // reasonable default
  }
  for (let i = 0; i < dims; i++) shape = { kind: 'list', item: shape }
  return shape
}

export function shapeToCanonical(shape: Shape): string {
  switch (shape.kind) {
    case 'scalar':
      switch (shape.base) {
        case 'int':
          return 'integer'
        case 'double':
          return 'double'
        case 'bool':
          return 'boolean'
        case 'string':
          return 'string'
      }
      break
    case 'list':
      return shapeToCanonical(shape.item) + '[]'
    case 'linkedlist':
      return 'ListNode'
    case 'tree':
      return 'TreeNode'
    case 'nestedinteger':
      return 'NestedInteger'
  }
}
