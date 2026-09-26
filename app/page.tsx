import PaperReader from './reader';
import {getChatGPTUser,chatGPTSignInPath,chatGPTSignOutPath} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Home(){const user=await getChatGPTUser();return <PaperReader account={user?.email||null} signInPath={chatGPTSignInPath('/')} signOutPath={chatGPTSignOutPath('/')}/>;}
