import {describe,expect,it} from 'vitest'
import {sortDocuments,sortTasks} from './App'
import type {DocumentRecord,InitiativeTask} from './model'

const doc=(p:Partial<DocumentRecord>):DocumentRecord=>({id:'x',initiativeId:'i',kind:'rm',title:'RM',authorId:'a',status:'submitted',body:'',version:1,versions:[],...p})

describe('backlog list ordering',()=>{
  it('sorts documents together by known dates without a separate source section',()=>{
    const rows=[
      doc({id:'old-live',submittedAt:'2026-01-01T00:00:00Z'}),
      doc({id:'source-old',historical:true,sourceDate:'2025-05-01',sourceOrder:1}),
      doc({id:'new-live',submittedAt:'2026-08-01T00:00:00Z'}),
      doc({id:'source-new',historical:true,sourceDate:'2026-06-01',sourceOrder:2}),
      doc({id:'undated',historical:true,sourceOrder:3}),
    ]
    expect(sortDocuments(rows,'newest').map(d=>d.id)).toEqual(['new-live','source-new','old-live','source-old','undated'])
  })

  it('sorts undated tasks after dated tasks',()=>{
    const tasks:InitiativeTask[]=[
      {id:'none',title:'None',description:'',status:'planned'},
      {id:'later',title:'Later',description:'',status:'planned',dueAt:'2026-10-02'},
      {id:'sooner',title:'Sooner',description:'',status:'planned',dueAt:'2026-09-12'},
    ]
    expect(sortTasks(tasks,'due').map(t=>t.id)).toEqual(['sooner','later','none'])
  })
})
