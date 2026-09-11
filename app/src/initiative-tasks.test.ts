import { describe, expect, it } from 'vitest'
import { demoAction } from './demo'
import { seed } from './model'

const fresh = () => structuredClone(seed)

describe('initiative tasks', () => {
  it('stores details, due date, assignee and initial status', async () => {
    const dueAt = '2026-09-20T23:00:00.000Z'
    const data = await demoAction(fresh(), 'maya', 'addTask', {
      initiativeId: 'sound', title: '  Analyze pilot  ', description: 'Compare both conditions.',
      dueAt, assigneeId: 'alex', status: 'pending',
    })
    expect(data.initiatives.find((i) => i.id === 'sound')!.tasks.at(-1)).toMatchObject({
      title: 'Analyze pilot', description: 'Compare both conditions.', dueAt,
      assigneeId: 'alex', status: 'pending',
    })
  })

  it('rejects invalid status and an assignee outside the initiative', async () => {
    await expect(demoAction(fresh(), 'maya', 'addTask', {
      initiativeId: 'sound', title: 'Bad status', status: 'done',
    })).rejects.toThrow(/status/i)
    await expect(demoAction(fresh(), 'maya', 'addTask', {
      initiativeId: 'sound', title: 'Wrong assignee', assigneeId: 'sam',
    })).rejects.toThrow(/team/i)
  })

  it('lets the assignee or lead change status, but not another teammate', async () => {
    let data = await demoAction(fresh(), 'alex', 'setTaskStatus', {
      initiativeId: 'sound', taskId: 't2', status: 'finished',
    })
    expect(data.initiatives.find((i) => i.id === 'sound')!.tasks.find((t) => t.id === 't2')!.status).toBe('finished')
    await expect(demoAction(data, 'alex', 'setTaskStatus', {
      initiativeId: 'sound', taskId: 't1', status: 'pending',
    })).rejects.toThrow(/authority/i)
    data = await demoAction(data, 'maya', 'setTaskStatus', {
      initiativeId: 'sound', taskId: 't1', status: 'pending',
    })
    expect(data.initiatives.find((i) => i.id === 'sound')!.tasks.find((t) => t.id === 't1')!.status).toBe('pending')
  })

  it('allows only the lead or admin to delete a task', async () => {
    await expect(demoAction(fresh(), 'alex', 'deleteTask', {
      initiativeId: 'sound', taskId: 't2',
    })).rejects.toThrow(/lead|admin/i)
    const data = await demoAction(fresh(), 'maya', 'deleteTask', {
      initiativeId: 'sound', taskId: 't2',
    })
    expect(data.initiatives.find((i) => i.id === 'sound')!.tasks.some((t) => t.id === 't2')).toBe(false)
  })
})
