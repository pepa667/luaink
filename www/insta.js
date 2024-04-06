// Replace with your Instagram Access Token
const accessToken = 'IGQWRNQ0lRaGpwZAkk3NVJHOUZASRy1BZAEhOaTE0RFFMYzJFSVZAiSy1NSWZAZAQmZAvaGs0NzFqTFFrY1VRenpia2ZAhU202VEVhNlJ3ZAHAta2ktcC1TazFQa2daeW9uTkVBdVhpNTFxSTRnN2MtN0hEaWxBQUF3b1ZABTHcZD';

// Function to fetch and display Instagram feed
function getInstagramFeed() {
    fetch(`https://graph.instagram.com/v12.0/me/media?fields=id,caption,media_type,media_url,permalink,timestamp&access_token=${accessToken}`)
        .then(response => response.json())
        .then(data => {
            const feedContainer = document.getElementById('instagram-feed');

            data.data.forEach(post => {
                const postLink = document.createElement('a');
                postLink.href = post.permalink;
                postLink.target = '_blank';

                const postImage = document.createElement('img');
                // postImage.src = "https://graph.facebook.com/v19.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Fp%2F&maxwidth=320&fields=thumbnail_url%2Cauthor_name%2Cprovider_name%2Cprovider_url&access_token=" + ${accessToken};
                postImage.src = post.media_url;
                postImage.alt = post.caption;

                postLink.appendChild(postImage);
                feedContainer.appendChild(postLink);
            });
        })
        .catch(error => console.error(error));
}

// Call the function to fetch and display the Instagram feed
getInstagramFeed();