import { Task } from "./task.entity";
export declare class Session {
    session_id: string;
    user_id: string;
    context: any;
    history: any;
    last_question: string;
    last_reply: string;
    created_at: Date;
    updated_at: Date;
    tasks: Task[];
}
