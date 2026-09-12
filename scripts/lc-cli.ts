import { mkdirSync } from 'fs'
import { join } from 'path'
import { LeetCodeClient } from '../src/main/leetcode'

const dir = join(process.cwd(), '.lc-test')
mkdirSync(dir, { recursive: true })

const host = process.argv[2] || 'leetcode.com'
const user = process.argv[3] || 'definitely_not_a_real_user_xyz'
const pass = process.argv[4] || 'wrongpass'

const c = new LeetCodeClient(dir)

console.log('initial status:', JSON.stringify(c.status(host)))

// cookie parse/import path (fake session → whoami fails → expect loggedIn with warning)
const fake = 'csrftoken=abcdef123456; LEETCODE_SESSION=fake_session_value_12345; other=1'
console.log('import fake cookie:', JSON.stringify(await c.importSessionFromText(host, fake)))

// submit guard: session is fake so submit should return an error before judging
console.log('submit without valid session:', JSON.stringify(await c.submit(host, 'two-sum', '1', 'python', 'class Solution:\n    pass\n')))
