import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  VK_MESSAGE_MAX,truncateVkMessage,vkBoardCommentCandidates,vkNameBook,vkPostCandidate,vkPostCandidates,
  vkPosts,vkWallCommentCandidates,
} from '@/lib/vk/parse';

// Fixtures are synthetic (shaped per VK API 5.199 docs); spike S0 replaces them with live ones.
const fixture=(name:string)=>JSON.parse(readFileSync(path.resolve(__dirname,'fixtures/vk',name),'utf8')).response;

describe('newsfeed.search → candidates (REQ-3, D4, AM-15)',()=>{
  const out=vkPostCandidates(fixture('newsfeed.search.json'));

  it('keys posts platform-wide and links to the wall post',()=>{
    expect(out.map((c)=>[c.key,c.url])).toEqual([
      ['vk:-11000_501','https://vk.com/wall-11000_501'],
      ['vk:-11000_502','https://vk.com/wall-11000_502'],
      ['vk:700300_77','https://vk.com/wall700300_77'],
    ]);
  });

  it('names a signed community post by its signer, an unsigned one by the community, a user post by the user',()=>{
    expect(out.map((c)=>c.name)).toEqual(['Пётр Подписной','Бизнес-клуб Тест','Анна Поиск']);
  });

  it('dates are ISO strings in UTC',()=>{
    expect(out[0].date).toBe(new Date(1790000000*1000).toISOString());
  });

  it('skips posts without text',()=>{
    expect(out.find((c)=>c.key==='vk:700300_78')).toBeUndefined();
  });
});

describe('wall.get → candidates (REQ-4)',()=>{
  it('suggested posts are named by their author',()=>{
    const out=vkPostCandidates(fixture('wall.get.json'));
    expect(out.map((c)=>[c.key,c.name])).toEqual([
      ['vk:-22000_9001','Нишевая группа'],
      ['vk:-22000_9000','Олег Предложкин'],
    ]);
    expect(vkPosts(fixture('wall.get.json')).map((p)=>p.id)).toEqual([9001,9000]);
  });
});

describe('wall.getComments → candidates',()=>{
  const out=vkWallCommentCandidates(fixture('wall.getComments.json'),{ownerId:-22000,postId:9001});

  it('keys comments by post and comment id and deep-links with reply / thread',()=>{
    expect(out.map((c)=>[c.key,c.url,c.name])).toEqual([
      ['vk:-22000_9001_c31','https://vk.com/wall-22000_9001?reply=31','Мария Комментова'],
      ['vk:-22000_9001_c33','https://vk.com/wall-22000_9001?reply=33&thread=31','Нишевая группа'],
    ]);
  });

  it('skips deleted (empty) comments',()=>{
    expect(out.some((c)=>c.key.endsWith('_c32'))).toBe(false);
  });
});

describe('board.getComments → candidates',()=>{
  it('keys by group/topic/comment and links to the topic post',()=>{
    const out=vkBoardCommentCandidates(fixture('board.getComments.json'),{groupId:22000,topicId:4400});
    expect(out.map((c)=>[c.key,c.url,c.name])).toEqual([
      ['vk:board22000_4400_120','https://vk.com/topic-22000_4400?post=120','Денис Обсуждалкин'],
      ['vk:board22000_4400_119','https://vk.com/topic-22000_4400?post=119','Нишевая группа'],
    ]);
  });
});

describe('robustness',()=>{
  it('one item seen by search and by the group wall gets the same key (REQ-6)',()=>{
    const book=vkNameBook({});
    const post={id:9001,owner_id:-22000,from_id:-22000,date:1,text:'x'};
    expect(vkPostCandidate(post,book)?.key).toBe(vkPostCandidates({items:[post]})[0].key);
  });

  it('truncates messages to 8000 without splitting a surrogate pair (AM-3)',()=>{
    expect(truncateVkMessage('a'.repeat(9000))).toHaveLength(VK_MESSAGE_MAX);
    const cut=truncateVkMessage('a'.repeat(VK_MESSAGE_MAX-1)+'😀'+'b');
    expect(cut).toBe('a'.repeat(VK_MESSAGE_MAX-1));
  });

  it('falls back to ids when names are missing and ignores malformed items',()=>{
    const out=vkPostCandidates({items:[{id:1,owner_id:5,from_id:5,date:1,text:'t'},{id:'x'},null,{id:2,owner_id:-7,date:1,text:'t'}]});
    expect(out.map((c)=>c.name)).toEqual(['id5','club7']);
    expect(vkPostCandidates(null)).toEqual([]);
  });
});
