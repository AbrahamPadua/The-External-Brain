import { expect, it } from 'vitest'
import { seed } from './model'
import { demoAction } from './demo'
import { obligationDocument, obligationWeek, isPublishedDocument, assignedReviewObligation } from './obligationPresentation'

it('requires an explicit obligation link or matching week, excluding history', () => {
  const ob = seed.obligations.find(o => o.id === 'o3')!
  const report = seed.documents.find(d => d.id === 'rm-memory')!
  expect(obligationDocument(ob, [report], false)).toBeUndefined()
  expect(obligationDocument(ob, [{...report, targetMonday:undefined}], false)).toBeUndefined()
  expect(obligationDocument(ob, [{...report, targetMonday:ob.cycleMonday, historical:true}], false)).toBeUndefined()
  expect(obligationDocument(ob, [{...report, targetMonday:ob.cycleMonday}], false)?.id).toBe(report.id)
  expect(obligationDocument(ob, [{...report, targetMonday:undefined, obligationId:ob.id}], false)?.id).toBe(report.id)
  expect(obligationDocument(ob, [{...report, targetMonday:ob.cycleMonday, obligationId:'other'}], false)).toBeUndefined()
})

it('selects only the current assignee and exact source version, refusing ambiguity', () => {
  const ob = seed.obligations.find(o=>o.kind==='review')!
  expect(assignedReviewObligation([ob], ob.assigneeId, ob.targetId, ob.targetVersion).id).toBe(ob.id)
  expect(()=>assignedReviewObligation([ob], 'alex', ob.targetId, ob.targetVersion)).toThrow(/unambiguous/)
  expect(()=>assignedReviewObligation([ob], ob.assigneeId, ob.targetId, 2)).toThrow(/unambiguous/)
  expect(()=>assignedReviewObligation([ob,{...ob,id:'other'}], ob.assigneeId, ob.targetId, ob.targetVersion)).toThrow(/unambiguous/)
  expect(assignedReviewObligation([ob,{...ob,id:'other'}], ob.assigneeId, ob.targetId, ob.targetVersion, 'other').id).toBe('other')
  expect(()=>assignedReviewObligation([{...ob,status:'complete'}],ob.assigneeId,ob.targetId,ob.targetVersion,ob.id)).toThrow(/unambiguous/)
  expect(assignedReviewObligation([{...ob,status:'complete'}],ob.assigneeId,ob.targetId,ob.targetVersion,ob.id,true).id).toBe(ob.id)
})

it('demo review drafts retain the precise obligation and assigned source version after that report advances',async()=>{
  const data=structuredClone(seed)
  const target=data.documents.find(d=>d.id==='rm-memory')!
  target.versions=[{version:1,body:target.body,at:target.submittedAt!},{version:2,body:'<p>New source</p>',at:'2026-09-06'}]
  target.version=2
  data.obligations.push({...data.obligations.find(o=>o.id==='o2')!,id:'other',targetVersion:2})
  const result=await demoAction(data,'maya','createDraft',{initiativeId:'memory',kind:'review',obligationId:'o2',targetId:target.id,targetVersion:1})
  expect(result.documents.find(d=>d.kind==='review')).toMatchObject({obligationId:'o2',targetId:target.id,targetVersion:1})
})

it('uses deadline compatibility only for demo and retains published revisions', () => {
  const ob = {...seed.obligations[0], cycleMonday:undefined}
  expect(obligationWeek(ob, false)).toBeUndefined()
  expect(obligationWeek(ob, true)).toBe('2026-09-07')
  const report = seed.documents[0]
  expect(isPublishedDocument({...report, status:'draft', submittedAt:undefined, versions:[]})).toBe(false)
  expect(isPublishedDocument({...report, status:'draft', versions:[{version:1,body:'Published',at:'2026-09-04'}]})).toBe(true)
})
