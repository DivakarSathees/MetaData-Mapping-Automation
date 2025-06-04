const axios = require('axios');

exports.updateMetaData = async (questionData, token) => {
    const results = {
        updated: [],
        notUpdated: [],
    };

    let questionNumber = 0;

    for (const question of questionData) {
        questionNumber++;
        const { q_id, question_type, sub_topic_name, topic_name, subject_name, score, ...restData } = question; // Exclude q_id and question_type from payload
        let url = '';
        let method = '';

        if(question?.statusOfUpload === false){
            results.notUpdated.push({ q_id, reason: 'score is < 60%', question_type, questionNumber, upload_question: restData, sub_topic_name, topic_name, subject_name, score });
            continue;
        }

        switch (question_type) {
            case 'project_question':
                url = `https://api.examly.io/api/update/project_question/${q_id}`;
                method = 'put';
                break;
            case 'mcq_single_correct':
            case 'mcq_multiple_correct':
                url = `https://api.examly.io/api/update_mcq_question/${q_id}`;
                method = 'post';
                break;
            case 'programming':
                url = `https://api.examly.io/api/update_programming_question/${q_id}`;
                method = 'put';
                break;
            default:
                results.notUpdated.push({ q_id, reason: 'Unknown question_type' });
                continue;
        }

        try {
            await axios({
                method,
                url,
                data: restData,
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            });

            console.log(`Updated Q.no ${questionNumber} ${question_type} with ID: ${q_id}`);
            results.updated.push({q_id, question_type, questionNumber, sub_topic_name, topic_name, subject_name, score, upload_question: restData });
            
        } catch (error) {
            console.error(`Failed to update Q.no ${questionNumber} question ID ${q_id}:`, error.message);
            results.notUpdated.push({ q_id, reason: error.message, question_type, questionNumber, upload_question: restData, sub_topic_name, topic_name, subject_name, score });
        }
    }

    return {
        success: results.notUpdated.length === 0,
        message: results.notUpdated.length === 0
            ? "All metadata updated successfully."
            : "Some questions were not updated.",
        results,

    };
};
